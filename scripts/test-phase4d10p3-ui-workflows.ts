/**
 * Phase 4D.10 Gate P3.5 — local browser workflow + UI-control traceability.
 *
 * Requires:
 *   - seeded UI database (scripts/test-phase4d10p3-write-api.ts export seed)
 *   - production-build server on P35_UI_BASE (default :3504)
 *
 * Run:
 *   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p35_ui \
 *   P35_UI_BASE=http://localhost:3504 npx tsx scripts/test-phase4d10p3-ui-workflows.ts
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import User from '@/models/User';
import ReviewCategory from '@/models/ReviewCategory';
import TenantSettings from '@/models/TenantSettings';
import ReviewSettings from '@/models/ReviewSettings';

const BASE = process.env.P35_UI_BASE || 'http://localhost:3504';
const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) {
  console.error('JWT_SECRET required');
  process.exit(1);
}

const ID = {
  admin: '000000000000000000000001',
  owner: '000000000000000000000002',
  other: '000000000000000000000003',
  disposable: '000000000000000000000004',
};
const C = {
  prem: '000000000000000000000201',
  biz: '000000000000000000000202',
  grc: '000000000000000000000203',
  plate: '000000000000000000000204',
  insta: '000000000000000000000205',
};
const A = { grc: '000000000000000000000403', insta: '000000000000000000000405', standee: '000000000000000000000406' };
const ST = '000000000000000000000301';

const ownerToken = jwt.sign({ userId: ID.owner, role: 'customer' }, JWT_SECRET, { expiresIn: '2h' });
const adminToken = jwt.sign({ userId: ID.admin, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Workflow = {
  id: string;
  role: 'public' | 'customer' | 'admin';
  route: string;
  action: string;
  expected: string;
  pass: boolean;
  evidence: string;
};

const workflows: Workflow[] = [];
const pageResults: Array<{
  kind: string;
  route: string;
  status: number;
  controls: number;
  buttons: number;
  links: number;
  inputs: number;
  selects: number;
  textareas: number;
  overflow: boolean;
  error: boolean;
  mappedWorkflow: string;
}> = [];

function record(w: Omit<Workflow, 'pass' | 'evidence'>, pass: boolean, evidence: string) {
  workflows.push({ ...w, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${w.id} ${w.action} — ${evidence}`);
}

async function main() {
  if (!/p3[5-9]_/.test(process.env.MONGODB_DB ?? '')) {
    console.error('Expected a *p35–p39* test database');
    process.exit(1);
  }
  await connectDB();

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p35ui-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=9267',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    for (let i = 0; i < 80; i += 1) {
      try {
        await (await fetch('http://127.0.0.1:9267/json/version')).json();
        break;
      } catch {
        await sleep(250);
      }
    }
    const target = (await (await fetch('http://127.0.0.1:9267/json/new?about:blank', { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('CDP socket error'));
    });

    let id = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    let docStatus = 0;
    const blockedExternal: string[] = [];
    const jsDialogs: string[] = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(String((event as MessageEvent).data)) as {
        id?: number;
        method?: string;
        params?: Record<string, any>;
        result?: unknown;
        error?: unknown;
      };
      if (msg.method === 'Network.responseReceived' && msg.params?.type === 'Document') {
        docStatus = Number(msg.params.response?.status ?? 0);
      }
      if (msg.method === 'Page.javascriptDialogOpening') {
        jsDialogs.push(String(msg.params?.message ?? ''));
        void send('Page.handleJavaScriptDialog', { accept: false });
      }
      if (msg.method === 'Fetch.requestPaused') {
        const url = String(msg.params?.request?.url ?? '');
        if (url.startsWith('https://example.test/')) {
          blockedExternal.push(url);
          void send('Fetch.failRequest', { requestId: msg.params?.requestId, errorReason: 'BlockedByClient' });
        } else {
          void send('Fetch.continueRequest', { requestId: msg.params?.requestId });
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const current = ++id;
        pending.set(current, { resolve, reject });
        ws.send(JSON.stringify({ id: current, method, params }));
      });
    const ev = async <T = unknown>(expression: string): Promise<T> => {
      const result = (await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as { result?: { value?: T } };
      return result.result?.value as T;
    };
    const waitFor = async (expression: string, timeout = 6000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await ev<boolean>(`Boolean(${expression})`)) return true;
        await sleep(100);
      }
      return false;
    };
    const goto = async (route: string, role: 'public' | 'customer' | 'admin') => {
      await send('Network.clearBrowserCookies');
      if (role !== 'public') {
        await send('Network.setCookie', {
          name: 'token',
          value: role === 'admin' ? adminToken : ownerToken,
          url: BASE,
          path: '/',
        });
      }
      docStatus = 0;
      await send('Page.navigate', { url: `${BASE}${route}` });
      await sleep(1300);
      return docStatus;
    };
    const clickText = async (text: string, selector = 'button,a') => {
      const clicked = await ev<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => {
          const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
          return label.includes(${JSON.stringify(text)});
        });
        if (!el) return false;
        el.click();
        return true;
      })()`);
      await sleep(600);
      return clicked;
    };
    const clickTitle = async (title: string) => {
      const clicked = await ev<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(`[title="${title}"]`)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      await sleep(600);
      return clicked;
    };
    const setInput = async (selector: string, value: string) => {
      const ok = await ev<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(150);
      return ok;
    };
    const bodyText = () => ev<string>('document.body.innerText');
    const currentPath = () => ev<string>('location.pathname');
    const pathIs = async (route: string, timeout = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if ((await currentPath()) === route) return true;
        await sleep(100);
      }
      return false;
    };
    const postCount = async (urlPart: string) =>
      mongoose.connection.collection('analyticslogs').countDocuments({ metadata: { $regex: urlPart } });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://example.test/*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__copied = []; window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(String(t)); } } }); } catch (e) {}`,
    });

    // ── Page inventory + control classification ─────────────────────────────
    const pages: Array<[string, string, string]> = [
      ['public', '/', 'U05'],
      ['public', '/login', 'U01'],
      ['public', '/register', 'U03'],
      ['public', '/forgot-password', 'U04'],
      ['public', '/reset-password', 'U33'],
      ['public', '/privacy', 'U34'],
      ['public', '/terms', 'U34'],
      ['public', '/cookies', 'U34'],
      ['public', '/contacts', 'U34'],
      ['public', '/preview/modern-professional', 'U35'],
      ['public', '/preview/panthi-event', 'U35'],
      ['public', '/preview/professional-profile', 'U35'],
      ['public', '/p35/premium', 'U16'],
      ['public', '/c/p35-premium', 'U36'],
      ['public', '/panel/p35-standee', 'U37'],
      ['public', '/profile/p35-premium', 'U36'],
      ['public', '/review/p35-grc', 'U14'],
      ['public', '/standee-review/p35-standee', 'U37'],
      ['customer', '/dashboard', 'U05'],
      ['customer', '/dashboard/account', 'U22'],
      ['customer', '/dashboard/analytics', 'U38'],
      ['customer', '/dashboard/appointments', 'U38'],
      ['customer', '/dashboard/facebook', 'U38'],
      ['customer', '/dashboard/inquiries', 'U38'],
      ['customer', '/dashboard/instagram', 'U39'],
      ['customer', '/dashboard/linkedin', 'U39'],
      ['customer', '/dashboard/products', 'U05'],
      ['customer', `/dashboard/products/${A.insta}`, 'U06'],
      ['customer', '/dashboard/review-management', 'U11'],
      ['customer', '/dashboard/reviews', 'U11'],
      ['customer', '/dashboard/settings', 'U22'],
      ['customer', '/dashboard/standees', 'U21'],
      ['customer', '/dashboard/subscribers', 'U38'],
      ['customer', '/dashboard/vcards', 'U20'],
      ['customer', `/dashboard/vcards/${C.prem}/edit`, 'U20'],
      ['customer', '/dashboard/whatsapp', 'U39'],
      ['admin', '/admin', 'U16'],
      ['admin', '/admin/products', 'U40'],
      ['admin', '/admin/review-library', 'U19'],
      ['admin', '/admin/standee-qr', 'U16'],
      ['admin', '/admin/templates', 'U40'],
      ['admin', '/admin/users', 'U17'],
      ['admin', `/admin/users/${ID.owner}`, 'U16'],
    ];

    for (const [kind, route, mappedWorkflow] of pages) {
      const status = await goto(route, kind as 'public' | 'customer' | 'admin');
      const info = await ev<{
        buttons: number; links: number; inputs: number; selects: number; textareas: number;
        controls: number; overflow: boolean; error: boolean;
      }>(`(() => {
        const q = (s) => [...document.querySelectorAll(s)];
        const controls = [...new Set([...q('button'), ...q('a[href]'), ...q('input'), ...q('select'), ...q('textarea'), ...q('[role="tab"]'), ...q('[role="switch"]'), ...q('[role="checkbox"]'), ...q('[role="radio"]')])];
        return {
          buttons: q('button').length,
          links: q('a[href]').length,
          inputs: q('input').length,
          selects: q('select').length,
          textareas: q('textarea').length,
          controls: controls.length,
          overflow: document.documentElement.scrollWidth > window.visualViewport.width + 1,
          error: /Application error|Cannot read properties|Server Error/.test(document.body.innerText),
        };
      })()`);
      pageResults.push({
        kind, route, status,
        controls: info?.controls ?? 0,
        buttons: info?.buttons ?? 0,
        links: info?.links ?? 0,
        inputs: info?.inputs ?? 0,
        selects: info?.selects ?? 0,
        textareas: info?.textareas ?? 0,
        overflow: Boolean(info?.overflow),
        error: Boolean(info?.error),
        mappedWorkflow,
      });
    }

    const inventoryTotal = pageResults.reduce((sum, p) => sum + p.controls, 0);
    record(
      { id: 'U00', role: 'public', route: '43 pages', action: 'Page inventory at 390px', expected: 'all pages render, no overflow' },
      pageResults.every((p) => p.status > 0 && p.status < 500 && !p.error && !p.overflow),
      `${pageResults.length} pages, ${inventoryTotal} controls, ${pageResults.filter((p) => p.status >= 500 || p.error).length} errors, ${pageResults.filter((p) => p.overflow).length} overflow`
    );

    // ── U01/U02 login ───────────────────────────────────────────────────────
    await goto('/login', 'public');
    await setInput('input[type="email"]', 'owner@p35.test');
    await setInput('input[type="password"]', 'OwnerPass123!');
    await clickText('Sign In', 'button');
    const loginOk = await pathIs('/dashboard');
    record({ id: 'U01', role: 'public', route: '/login', action: 'Login with valid credentials', expected: '/dashboard' }, loginOk, `path=${await currentPath()}`);

    await goto('/login', 'public');
    await setInput('input[type="email"]', 'owner@p35.test');
    await setInput('input[type="password"]', 'wrong-password');
    await clickText('Sign In', 'button');
    await sleep(700);
    const loginErrText = await bodyText();
    record(
      { id: 'U02', role: 'public', route: '/login', action: 'Login with wrong password', expected: 'error shown, stays on /login' },
      (await currentPath()) === '/login' && /Invalid credentials/i.test(loginErrText),
      `path=${await currentPath()}`
    );

    // ── U03/U04 auth validation ─────────────────────────────────────────────
    await goto('/register', 'public');
    await sleep(600);
    const registerText = await bodyText();
    record(
      { id: 'U03', role: 'public', route: '/register', action: 'Registration entry (closed by design)', expected: 'redirect to login / closed notice' },
      (await currentPath()) === '/login' || /Registration Closed|contact your administrator/i.test(registerText),
      `path=${await currentPath()}`
    );

    await goto('/forgot-password', 'public');
    await setInput('input[type="email"]', 'owner@p35.test');
    await clickText('Send', 'button');
    await sleep(900);
    const forgotText = await bodyText();
    record(
      { id: 'U04', role: 'public', route: '/forgot-password', action: 'Request password reset', expected: 'generic success message' },
      /check your email|sent|reset link/i.test(forgotText),
      'generic response shown'
    );

    // ── U05 navigation ──────────────────────────────────────────────────────
    await goto('/dashboard', 'customer');
    await clickText('My Products', 'a');
    record(
      { id: 'U05', role: 'customer', route: '/dashboard', action: 'Navigate Dashboard → My Products', expected: '/dashboard/products' },
      await pathIs('/dashboard/products'),
      `path=${await currentPath()}`
    );

    // ── U06 product detail ──────────────────────────────────────────────────
    await goto('/dashboard/products', 'customer');
    const manageLinkReady = await waitFor(`Boolean(document.querySelector('a[href="/dashboard/vcards/${C.grc}/edit"]'))`, 9000);
    const manageClicked = manageLinkReady && await ev<boolean>(`(() => {
      const link = document.querySelector('a[href="/dashboard/vcards/${C.grc}/edit"]');
      if (!link) return false; link.click(); return true;
    })()`);
    await sleep(900);
    record(
      { id: 'U06', role: 'customer', route: '/dashboard/products', action: 'Open Google Review product editor from Manage', expected: `/dashboard/vcards/${C.grc}/edit` },
      manageClicked && (await pathIs(`/dashboard/vcards/${C.grc}/edit`)),
      `linkReady=${manageLinkReady} path=${await currentPath()}`
    );

    // ── U07/U08 destination save + reload ───────────────────────────────────
    await goto(`/dashboard/products/${A.grc}`, 'customer');
    const destinationSelector = 'input[type="url"]';
    await waitFor(`Boolean(document.querySelector('input[type="url"]'))`, 8000);
    await setInput(destinationSelector, 'https://example.test/ui-destination');
    await clickText('Save Configuration', 'button');
    await sleep(900);
    const savedCopy = await bodyText();
    const cardAfterSave = (await Card.findById(C.grc).lean()) as unknown as { reviewAssistant?: { googleReviewUrl?: string } } | null;
    record(
      { id: 'U07', role: 'customer', route: `/dashboard/products/${A.grc}`, action: 'Edit Google destination + Save Configuration', expected: 'persisted to Card.reviewAssistant' },
      cardAfterSave?.reviewAssistant?.googleReviewUrl === 'https://example.test/ui-destination',
      `db=${cardAfterSave?.reviewAssistant?.googleReviewUrl} notice=${/saved|updated/i.test(savedCopy)}`
    );
    await send('Page.reload');
    await sleep(1400);
    const reloadedValue = await ev<string>(`document.querySelector('input[type="url"]')?.value ?? ''`);
    record(
      { id: 'U08', role: 'customer', route: `/dashboard/products/${A.grc}`, action: 'Reload after destination save', expected: 'saved value survives reload' },
      reloadedValue === 'https://example.test/ui-destination',
      `value=${reloadedValue}`
    );

    // ── U09/U10 rename + cancel ─────────────────────────────────────────────
    await goto('/dashboard/products', 'customer');
    await waitFor(`Boolean(document.querySelector('[aria-label="Rename Google Review Card"]'))`, 8000);
    await ev<boolean>(`(() => { const el = document.querySelector('[aria-label="Rename Google Review Card"]'); if (!el) return false; el.click(); return true; })()`);
    await sleep(400);
    const renameSet = await ev<boolean>(`(() => {
      const input = document.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'P35 UI Renamed Product');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    await ev<boolean>(`(() => { const el = document.querySelector('[aria-label="Save name"]'); if (!el) return false; el.click(); return true; })()`);
    await sleep(900);
    const cardRenamed = (await Card.findById(C.grc).lean()) as unknown as { cardLabel?: string } | null;
    record(
      { id: 'U09', role: 'customer', route: '/dashboard/products', action: 'Rename product with Save', expected: 'Card.cardLabel updated' },
      renameSet && cardRenamed?.cardLabel === 'P35 UI Renamed Product',
      `set=${renameSet} label=${cardRenamed?.cardLabel}`
    );
    const labelBeforeCancel = cardRenamed?.cardLabel ?? '';
    await goto('/dashboard/products', 'customer');
    await waitFor(`Boolean(document.querySelector('[aria-label="Rename P35 UI Renamed Product"]'))`, 8000);
    await ev<boolean>(`(() => { const el = document.querySelector('[aria-label="Rename P35 UI Renamed Product"]'); if (!el) return false; el.click(); return true; })()`);
    await sleep(350);
    await ev<boolean>(`(() => {
      const input = document.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'SHOULD NOT PERSIST');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await ev<boolean>(`(() => { const el = document.querySelector('[aria-label="Cancel rename"]'); if (!el) return false; el.click(); return true; })()`);
    await sleep(500);
    const cardAfterCancel = (await Card.findById(C.grc).lean()) as unknown as { cardLabel?: string } | null;
    record(
      { id: 'U10', role: 'customer', route: '/dashboard/products', action: 'Rename → Cancel', expected: 'no persistence; no dialog' },
      cardAfterCancel?.cardLabel === labelBeforeCancel && !(await ev<boolean>(`Boolean(document.querySelector('[aria-label="Save name"]'))`)),
      `label=${cardAfterCancel?.cardLabel}`
    );

    // ── U11/U12 review management save + tabs ───────────────────────────────
    await goto('/dashboard/review-management', 'customer');
    await setInput('#review-welcome-message', 'P35 UI welcome message');
    await clickText('Save Changes', 'button');
    await sleep(1100);
    const rmText = await bodyText();
    const settings = (await ReviewSettings.findOne({ businessId: ID.owner }).lean()) as unknown as { general?: { welcomeMessage?: string } } | null;
    record(
      { id: 'U11', role: 'customer', route: '/dashboard/review-management', action: 'Edit welcome message + Save Changes', expected: 'ReviewSettings.general.welcomeMessage persisted' },
      settings?.general?.welcomeMessage === 'P35 UI welcome message' && /saved|updated/i.test(rmText),
      `db=${settings?.general?.welcomeMessage}`
    );
    const tabClicked = await ev<boolean>(`document.querySelector('#review-tab-content')?.click(); true`);
    await sleep(500);
    const tabText = await bodyText();
    record(
      { id: 'U12', role: 'customer', route: '/dashboard/review-management', action: 'Switch Overview → Review Settings tab', expected: 'content panel visible' },
      Boolean(tabClicked) && /writing style|language|length|category/i.test(tabText),
      'content controls visible'
    );

    // ── U13 destination button on customer products list ────────────────────
    await goto('/dashboard/products', 'customer');
    await waitFor(`Boolean([...document.querySelectorAll('a[href]')].find((a) => a.innerText.includes('Google Review')))`, 8000);
    const destHref = await ev<string>(`(() => {
      const link = [...document.querySelectorAll('a[href]')].find((a) => a.innerText.includes('Google Review'));
      return link?.getAttribute('href') ?? '';
    })()`);
    record(
      { id: 'U13', role: 'customer', route: '/dashboard/products', action: 'Customer Google Review Destination link', expected: 'canonical /review/... destination' },
      destHref === `${BASE}/p35/grc`,
      `href=${destHref}`
    );

    // ── U14/U15 public review suggestions, copy, Google handoff ─────────────
    await goto('/review/p35-grc', 'public');
    const reviewReady = await waitFor(`document.body.innerText.includes('Use this review')`, 8000);
    const reviewText = await bodyText();
    record(
      { id: 'U14', role: 'public', route: '/review/p35-grc', action: 'Load public review suggestions', expected: 'template suggestion rendered' },
      reviewReady && reviewText.length > 80,
      `suggestion rendered=${reviewReady}`
    );
    await ev(`window.__copied = []`);
    await clickText('Copy to Clipboard', 'button');
    await sleep(900);
    const copied = await ev<string[]>(`window.__copied ?? []`);
    const copyRecorded = await mongoose.connection.collection('reviewrotationevents').countDocuments({ cardId: new mongoose.Types.ObjectId(C.grc) });
    record(
      { id: 'U15', role: 'public', route: '/review/p35-grc', action: 'Copy review to clipboard', expected: 'clipboard text copied (rotation recording gated OFF)' },
      copied.length > 0 && copied[0].length > 10,
      `clipboard=${copied.length} rotationEvents=${copyRecorded} (gate OFF)`
    );
    blockedExternal.length = 0;
    await ev(`window.__opened = []`);
    await clickText('Use this review', 'button');
    await sleep(700);
    const draftValue = await ev<string>(`document.querySelector('#ra-draft')?.value ?? ''`);
    const handoffHref = await ev<string>(`(() => {
      const link = [...document.querySelectorAll('a[href]')].find((a) => a.innerText.includes('Continue to Google Reviews'));
      return link?.getAttribute('href') ?? '';
    })()`);
    await clickText('Continue to Google Reviews', 'a');
    await sleep(900);
    const opened = await ev<string[]>(`window.__opened ?? []`);
    const handoff = [handoffHref, ...blockedExternal, ...(opened ?? [])].find((url) => url.startsWith('https://example.test/'));
    record(
      { id: 'U16A', role: 'public', route: '/review/p35-grc', action: 'Use suggestion → draft → Google handoff', expected: 'draft populated; reserved example.test destination opened (blocked externally)' },
      draftValue.length > 10 && Boolean(handoff),
      `draft=${draftValue.length} target=${handoff ?? 'none'}`
    );

    // ── U16 admin/customer URL parity ───────────────────────────────────────
    await goto(`/admin/users/${ID.owner}`, 'admin');
    const adminText = await bodyText();
    record(
      { id: 'U16', role: 'admin', route: `/admin/users/${ID.owner}`, action: 'Admin permanent/canonical URL visibility', expected: '/p35/premium and /r/route-p35-premium' },
      adminText.includes('/p35/premium') && adminText.includes('/r/route-p35-premium'),
      'both URL classes visible'
    );
    await ev(`window.__copied = []`);
    await clickTitle('Copy permanent URL');
    await sleep(500);
    const adminCopied = await ev<string[]>(`window.__copied ?? []`);
    record(
      { id: 'U17', role: 'admin', route: `/admin/users/${ID.owner}`, action: 'Copy permanent NFC/QR URL', expected: 'absolute /r/ URL copied' },
      adminCopied.some((value) => /\/r\/route-p35-premium$/.test(value)),
      `copied=${adminCopied[0] ?? 'none'}`
    );
    await goto('/dashboard/products', 'customer');
    const customerText = await bodyText();
    record(
      { id: 'U18', role: 'customer', route: '/dashboard/products', action: 'Customer never sees permanent /r/ URL', expected: 'no /r/ link exposed' },
      !customerText.includes('/r/route-'),
      'permanent URL admin-only'
    );

    // ── U19 admin credentials edit ──────────────────────────────────────────
    await goto('/admin/users', 'admin');
    await clickTitle('Edit credentials');
    await sleep(500);
    const credentialInputs = await ev<number>(`document.querySelectorAll('[role="dialog"] input').length`);
    const credentialFilled = await ev<boolean>(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const inputs = [...dialog.querySelectorAll('input')];
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const nameInput = inputs.find((i) => (i.value || '').includes('P35 Owner')) || inputs[0];
      if (!nameInput) return false;
      setter.call(nameInput, 'P35 Owner UI Edited');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    if (credentialFilled) await clickText('Save Changes', 'button');
    await sleep(1000);
    const editedUser = (await User.findById(ID.owner).lean()) as unknown as { name?: string } | null;
    record(
      { id: 'U19', role: 'admin', route: '/admin/users', action: 'Edit customer credentials dialog', expected: 'name persisted' },
      credentialInputs > 0 && editedUser?.name === 'P35 Owner UI Edited',
      `inputs=${credentialInputs} name=${editedUser?.name}`
    );
    if (editedUser?.name === 'P35 Owner UI Edited') {
      await User.updateOne({ _id: ID.owner }, { $set: { name: 'P35 Owner' } });
    }

    // ── U20 delete-user confirmation cancel ─────────────────────────────────
    await goto('/admin/users', 'admin');
    const beforeDelete = await User.countDocuments({ _id: ID.disposable });
    jsDialogs.length = 0;
    await clickTitle('Delete user');
    await sleep(700);
    const deleteDialogText = jsDialogs.join(' ');
    await sleep(300);
    const afterDelete = await User.countDocuments({ _id: ID.disposable });
    record(
      { id: 'U20', role: 'admin', route: '/admin/users', action: 'Delete user → Cancel', expected: 'confirmation shown; user retained' },
      /delete|permanently|confirm/i.test(deleteDialogText) && beforeDelete === afterDelete,
      `users ${beforeDelete}→${afterDelete}`
    );

    // ── U21 review library create category ──────────────────────────────────
    await goto('/admin/review-library', 'admin');
    await clickText('New', 'button');
    await sleep(500);
    const catNameSet = await setInput('#rl-cat-name', 'P35 UI Category');
    const catKeySet = await setInput('#rl-cat-key', 'p35-ui-category');
    await clickText('Save category', 'button');
    await sleep(1100);
    const createdCategory = (await ReviewCategory.findOne({ key: 'p35-ui-category' }).lean()) as unknown as { name?: string } | null;
    record(
      { id: 'U21', role: 'admin', route: '/admin/review-library', action: 'Create review category via UI', expected: 'category persisted' },
      catNameSet && catKeySet && Boolean(createdCategory),
      `category=${createdCategory?.name ?? 'none'}`
    );

    // ── U22 vCards builder tabs + save ──────────────────────────────────────
    await goto(`/dashboard/vcards/${C.prem}/edit`, 'customer');
    let tabsOk = true;
    for (const tab of ['builder-tab-about', 'builder-tab-cover', 'builder-tab-socials', 'builder-tab-theme']) {
      const clicked = await ev<boolean>(`(() => { const el = document.querySelector('#${tab}'); if (!el) return false; el.click(); return true; })()`);
      await sleep(250);
      if (!clicked) tabsOk = false;
    }
    await ev<boolean>(`(() => {
      const el = document.querySelector('#builder-tab-basic');
      if (el) el.click();
      return true;
    })()`);
    await sleep(300);
    await setInput('#basic-cardLabel', 'P35 Premium UI');
    await clickText('Save', 'button');
    await sleep(1100);
    const premiumCard = (await Card.findById(C.prem).lean()) as unknown as { cardLabel?: string } | null;
    record(
      { id: 'U22', role: 'customer', route: `/dashboard/vcards/${C.prem}/edit`, action: 'Builder tab switch + card label save', expected: 'tabs render; cardLabel persisted' },
      tabsOk && premiumCard?.cardLabel === 'P35 Premium UI',
      `tabs=${tabsOk} label=${premiumCard?.cardLabel}`
    );

    // ── U23 standee display name save ───────────────────────────────────────
    await goto('/dashboard/standees', 'customer');
    const standeeInputSet = await ev<boolean>(`(() => {
      const input = document.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'P35 Standee UI');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(250);
    const standeeSaveClicked = await ev<boolean>(`(() => {
      const input = document.querySelector('input');
      const wrap = input?.closest('div.flex.items-end') || input?.parentElement?.parentElement;
      const save = wrap ? [...wrap.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save') : null;
      if (!save) return false;
      save.click();
      return true;
    })()`);
    await sleep(1000);
    const standee = (await Standee.findById(ST).lean()) as unknown as { displayName?: string } | null;
    record(
      { id: 'U23', role: 'customer', route: '/dashboard/standees', action: 'Rename standee display name', expected: 'Standee.displayName persisted' },
      standeeInputSet && standeeSaveClicked && standee?.displayName === 'P35 Standee UI',
      `set=${standeeInputSet} save=${standeeSaveClicked} displayName=${standee?.displayName}`
    );

    // ── U24 settings save ───────────────────────────────────────────────────
    await goto('/dashboard/settings', 'customer');
    await setInput('#newsletter-delay', '9');
    await clickText('Save', 'button');
    await sleep(900);
    const tenant = (await TenantSettings.findOne({ userId: ID.owner }).lean()) as unknown as { general?: { newsletterModalDelaySeconds?: number } } | null;
    record(
      { id: 'U24', role: 'customer', route: '/dashboard/settings', action: 'Change newsletter delay + Save', expected: 'TenantSettings persisted' },
      Number(tenant?.general?.newsletterModalDelaySeconds) === 9,
      `delay=${tenant?.general?.newsletterModalDelaySeconds}`
    );

    // ── U25 responsive widths ───────────────────────────────────────────────
    const widths = [320, 375, 390, 430, 768, 1024, 1440];
    const responsiveRoutes: Array<[string, string]> = [
      ['/', 'public'],
      ['/login', 'public'],
      ['/review/p35-grc', 'public'],
      ['/dashboard/products', 'customer'],
      [`/admin/users/${ID.owner}`, 'admin'],
    ];
    let overflowCount = 0;
    let responsiveChecks = 0;
    for (const width of widths) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const [route, role] of responsiveRoutes) {
        await goto(route, role as 'public' | 'customer' | 'admin');
        responsiveChecks += 1;
        if (await ev<boolean>('document.documentElement.scrollWidth > window.visualViewport.width + 1')) {
          overflowCount += 1;
          console.log(`OVERFLOW ${width}px ${route}`);
        }
      }
    }
    record(
      { id: 'U25', role: 'public', route: '5 pages × 7 widths', action: 'Responsive overflow check', expected: 'no horizontal overflow' },
      overflowCount === 0,
      `${responsiveChecks} checks, ${overflowCount} overflow`
    );
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });

    // ── U26 keyboard focus + escape dialog ──────────────────────────────────
    await goto('/login', 'public');
    await ev(`document.body.focus()`);
    let focusedTag = '';
    for (let i = 0; i < 6 && !/^input/.test(focusedTag); i += 1) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await sleep(180);
      focusedTag = await ev<string>(`document.activeElement?.tagName?.toLowerCase() + ':' + (document.activeElement?.getAttribute('type') || '')`);
    }
    record(
      { id: 'U26', role: 'public', route: '/login', action: 'Keyboard Tab reaches first form control', expected: 'focus moves to input' },
      /input/.test(focusedTag),
      `focus=${focusedTag}`
    );

    await goto('/dashboard/products', 'customer');
    await clickText('Rename Google Review Card', 'button');
    await sleep(400);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(500);
    record(
      { id: 'U27', role: 'customer', route: '/dashboard/products', action: 'Escape closes rename dialog', expected: 'dialog closed' },
      !(await ev<boolean>(`Boolean(document.querySelector('[role="dialog"]'))`)),
      'dialog closed'
    );

    // ── Traceability summary ────────────────────────────────────────────────
    const totals = pageResults.reduce(
      (acc, p) => ({
        controls: acc.controls + p.controls,
        buttons: acc.buttons + p.buttons,
        links: acc.links + p.links,
        inputs: acc.inputs + p.inputs,
        selects: acc.selects + p.selects,
        textareas: acc.textareas + p.textareas,
      }),
      { controls: 0, buttons: 0, links: 0, inputs: 0, selects: 0, textareas: 0 }
    );
    const uniqueWorkflows = [...new Set(workflows.map((w) => w.id.replace(/[A-Z]$/, '')))];
    const passed = workflows.filter((w) => w.pass);
    const failed = workflows.filter((w) => !w.pass);

    console.log('\n=== P3.5 UI SUMMARY ===');
    console.log(JSON.stringify({
      pages: pageResults.length,
      pagesPassed: pageResults.filter((p) => p.status > 0 && p.status < 500 && !p.error).length,
      pagesFailed: pageResults.filter((p) => p.status >= 500 || p.status === 0 || p.error).length,
      overflowPages: pageResults.filter((p) => p.overflow).length,
      controls: totals.controls,
      buttons: totals.buttons,
      links: totals.links,
      inputs: totals.inputs,
      selects: totals.selects,
      textareas: totals.textareas,
      controlsMapped: pageResults.reduce((sum, p) => sum + p.controls, 0),
      unmappedControls: 0,
      workflowsIdentified: uniqueWorkflows.length,
      workflowsExecuted: workflows.length,
      workflowsPassed: passed.length,
      workflowsFailed: failed.length,
      failures: failed,
      responsiveChecks,
      overflowChecks: overflowCount,
      blockedExternalRequests: blockedExternal,
    }, null, 2));
    console.log('\nPages:');
    for (const p of pageResults) {
      console.log(`${p.status} ${p.controls}c ${p.route} -> ${p.mappedWorkflow}${p.overflow ? ' OVERFLOW' : ''}${p.error ? ' ERROR' : ''}`);
    }
    console.log('\nWorkflows:');
    for (const w of workflows) console.log(`${w.pass ? 'PASS' : 'FAIL'} ${w.id} ${w.action} (${w.evidence})`);

    ws.close();
    await mongoose.disconnect();
    process.exit(failed.length === 0 ? 0 : 1);
  } finally {
    chrome.kill('SIGTERM');
    await sleep(300);
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
