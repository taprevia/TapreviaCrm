/**
 * P3.6 local accessibility audit — axe-core + keyboard + responsive checks.
 *
 * axe-core is injected from the locally installed package. No network access.
 */

import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.P36_BASE || 'http://localhost:3522';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const ADMIN = '000000000000000000000001';
const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '2h' });
const adminToken = jwt.sign({ userId: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
const AXE = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pages: Array<[string, 'public' | 'customer' | 'admin']> = [
  ['/', 'public'],
  ['/login', 'public'],
  ['/contacts', 'public'],
  ['/p35/premium', 'public'],
  ['/review/p35-grc', 'public'],
  ['/dashboard', 'customer'],
  ['/dashboard/products', 'customer'],
  ['/dashboard/review-management', 'customer'],
  ['/dashboard/standees', 'customer'],
  ['/admin/review-library', 'admin'],
  [`/admin/users/${OWNER}`, 'admin'],
];

async function main() {
  if (!JWT_SECRET) throw new Error('JWT_SECRET required');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p36a11y-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9273', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i += 1) {
      try { await (await fetch('http://127.0.0.1:9273/json/version')).json(); break; } catch { await sleep(200); }
    }
    const target = (await (await fetch('http://127.0.0.1:9273/json/new?about:blank', { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp')); });
    let id = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    let blocked = 0;
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number; method?: string; params?: any; result?: unknown; error?: unknown };
      if (msg.method === 'Fetch.requestPaused') {
        const url = String(msg.params?.request?.url ?? '');
        if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) {
          void send('Fetch.continueRequest', { requestId: msg.params?.requestId });
        } else {
          blocked += 1;
          void send('Fetch.failRequest', { requestId: msg.params?.requestId, errorReason: 'BlockedByClient' });
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
    };
    const ev = async <T = unknown>(expression: string): Promise<T> => {
      const r = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as { result?: { value?: T } };
      return r.result?.value as T;
    };
    const key = async (k: string, code: string, vk: number) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(120);
    };
    const goto = async (route: string, role: string) => {
      await send('Network.clearBrowserCookies');
      if (role !== 'public') {
        await send('Network.setCookie', {
          name: 'token',
          value: role === 'admin' ? adminToken : ownerToken,
          url: BASE,
          path: '/',
        });
      }
      await send('Page.navigate', { url: `${BASE}${route}` });
      await sleep(1800);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: AXE });

    const axeResults: Array<{ route: string; status: number; violations: number; byImpact: Record<string, number>; details: unknown[]; error?: string }> = [];
    for (const [route, role] of pages) {
      await goto(route, role);
      let out: any;
      try {
        out = await ev<any>(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } }).then(r => ({
          violations: r.violations.length,
          byImpact: r.violations.reduce((acc, v) => { acc[v.impact || 'unknown'] = (acc[v.impact || 'unknown'] || 0) + 1; return acc; }, {}),
          details: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(' ') || '', failure: v.nodes[0]?.failureSummary || '' }))
        })).catch(e => ({ error: String(e) }))`);
      } catch (error) {
        out = { error: String(error) };
      }
      axeResults.push({ route, status: 0, violations: out?.violations ?? 0, byImpact: out?.byImpact ?? {}, details: out?.details ?? [], error: out?.error });
      console.log(`${out?.violations ? 'FAIL' : 'PASS'} axe ${route} violations=${out?.violations ?? 'error'} ${out?.error ?? ''}`);
    }

    // Custom structural checks.
    const structural: Array<{ route: string; unnamedButtons: number; unlabeledInputs: number; imagesNoAlt: number; duplicateIds: number; headingJumps: number }> = [];
    for (const [route, role] of pages) {
      await goto(route, role);
      const s = await ev<any>(`(() => {
        const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const name = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby') || '').trim();
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const unnamedButtons = buttons.filter(b => !name(b) && !b.querySelector('img[alt]:not([alt=""])')).length;
        const inputs = [...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(visible);
        const unlabeledInputs = inputs.filter(i => {
          if (i.getAttribute('aria-label') || i.getAttribute('aria-labelledby')) return false;
          if (i.id && document.querySelector('label[for="' + CSS.escape(i.id) + '"]')) return false;
          return !i.closest('label');
        }).length;
        const imagesNoAlt = [...document.querySelectorAll('img')].filter(i => visible(i) && !i.hasAttribute('alt')).length;
        const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
        const dup = ids.filter((v, idx) => ids.indexOf(v) !== idx);
        const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(h => Number(h.tagName[1]));
        let jumps = 0; let last = 0;
        for (const h of headings) { if (last && h > last + 1) jumps += 1; last = h; }
        return { unnamedButtons, unlabeledInputs, imagesNoAlt, duplicateIds: new Set(dup).size, headingJumps: jumps };
      })()`);
      structural.push({ route, ...s });
    }

    // Keyboard: login tab order.
    await goto('/login', 'public');
    await ev(`document.body.focus()`);
    let focusSeq: string[] = [];
    let focusVisible = false;
    for (let i = 0; i < 8; i += 1) {
      await key('Tab', 'Tab', 9);
      focusSeq.push(await ev<string>(`(() => { const e = document.activeElement; return e ? e.tagName.toLowerCase() + ':' + (e.getAttribute('type') || e.getAttribute('name') || e.innerText?.trim().slice(0,20) || '') : 'none'; })()`));
      if (i === 1) {
        focusVisible = await ev<boolean>(`(() => { const e = document.activeElement; if (!e) return false; const s = getComputedStyle(e); return (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || s.boxShadow !== 'none'; })()`);
      }
    }

    // Keyboard: dialog focus trap + Escape restore (admin credentials modal).
    await goto('/admin/users', 'admin');
    const trigger = `[title="Edit credentials"]`;
    await ev(`(() => { const el = document.querySelector('${trigger}'); el?.focus(); el?.click(); return true; })()`);
    await sleep(500);
    const dialogInitial = await ev<boolean>(`Boolean(document.querySelector('[role="dialog"]')) && document.activeElement === document.querySelector('[role="dialog"] input')`);
    const inside: boolean[] = [];
    for (let i = 0; i < 8; i += 1) {
      await key('Tab', 'Tab', 9);
      inside.push(await ev<boolean>(`Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))`));
    }
    await key('Escape', 'Escape', 27);
    await sleep(300);
    const dialogClosed = await ev<boolean>(`!document.querySelector('[role="dialog"]')`);
    const focusRestored = await ev<boolean>(`document.activeElement === document.querySelector('${trigger}')`);

    // Responsive + text resize.
    const widths = [320, 375, 390, 430, 768, 1024, 1440];
    const responsiveRoutes: Array<[string, string]> = [
      ['/', 'public'],
      ['/login', 'public'],
      ['/review/p35-grc', 'public'],
      ['/dashboard/products', 'customer'],
      [`/admin/users/${OWNER}`, 'admin'],
    ];
    let overflow = 0;
    let responsiveChecks = 0;
    for (const width of widths) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const [route, role] of responsiveRoutes) {
        await goto(route, role);
        responsiveChecks += 1;
        if (await ev<boolean>('document.documentElement.scrollWidth > window.visualViewport.width + 1')) overflow += 1;
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await goto('/dashboard/products', 'customer');
    const textZoomOverflow = await ev<boolean>(`(() => { document.documentElement.style.fontSize = '200%'; return document.documentElement.scrollWidth > window.visualViewport.width + 1; })()`);

    const totalViolations = axeResults.reduce((s, r) => s + r.violations, 0);
    const failedPages = axeResults.filter((r) => r.violations > 0 || r.error);
    console.log('\n=== P3.6 ACCESSIBILITY SUMMARY ===');
    console.log(JSON.stringify({
      axe: {
        engine: 'axe-core 4.13.0',
        pages: axeResults.length,
        pagesPassed: axeResults.length - failedPages.length,
        pagesWithViolations: failedPages.length,
        violations: totalViolations,
        results: axeResults,
      },
      structural,
      keyboard: {
        loginFocusOrder: focusSeq,
        focusVisible,
        dialogInitialFocus: dialogInitial,
        tabStayedInsideDialog: inside.every(Boolean),
        escapeClosedDialog: dialogClosed,
        focusRestoredToTrigger: focusRestored,
      },
      responsive: { checks: responsiveChecks, overflow, textZoom200Overflow: textZoomOverflow },
      externalRequestsBlocked: blocked,
      screenReader: 'NOT VERIFIED',
    }, null, 2));
    ws.close();
    process.exit(failedPages.length === 0 && overflow === 0 ? 0 : 1);
  } finally {
    chrome.kill('SIGTERM');
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
