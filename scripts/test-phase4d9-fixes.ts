/**
 * Phase 4D.9 — 4D.8 fix regression: responsive Card Builder + duplicate UID
 * activation (sequential, normalization, cross-customer, removed re-add,
 * concurrency).
 *
 * Runs against the disposable local matrix database and a local Next server.
 * Seeds only synthetic admin/target accounts. Never touches production.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

const require = createRequire('/Users/prince/Documents/CRM/package.json');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE ?? 'http://localhost:3501';
const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('taprevia_4d9_')) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_4d9_ (got "${DB_NAME}")`);
  process.exit(2);
}
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing non-local TEST_BASE: ${BASE}`);
  process.exit(2);
}
const envFile = fs.readFileSync('/Users/prince/Documents/CRM/.env.local', 'utf8');
const secret = /^JWT_SECRET=(.*)$/m.exec(envFile)?.[1].trim().replace(/^"|"$/g, '');
if (!secret) throw new Error('JWT_SECRET missing');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const failures: string[] = [];
const results: {
  editor: Array<Record<string, unknown>>;
  activation: Record<string, unknown>;
} = { editor: [], activation: {} };

async function main() {
  await mongoose.connect(`mongodb://localhost:27017/${DB_NAME}`);
  const db = mongoose.connection.db!;

  const owner = await db.collection('users').findOne({ email: 'owner@matrix49.test' });
  if (!owner) throw new Error('owner fixture missing');
  const premiumCard = await db.collection('cards').findOne({ urlAlias: 'premium-4d9' });
  if (!premiumCard) throw new Error('premium card fixture missing');

  const adminId = oid();
  const targetId = oid();
  const target2Id = oid();
  const base = { passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now };

  // Deterministic reruns: clear only this script's synthetic activation data.
  const staleUsers = await db.collection('users')
    .find({ email: { $in: ['admin@matrix49.test', 'target@matrix49.test', 'target2@matrix49.test'] } })
    .project({ _id: 1 })
    .toArray();
  const staleIds = staleUsers.map((row) => row._id);
  if (staleIds.length) {
    await db.collection('userproducts').deleteMany({ userId: { $in: staleIds } });
    await db.collection('standees').deleteMany({ userId: { $in: staleIds } });
    await db.collection('users').deleteMany({ _id: { $in: staleIds } });
  }
  await db.collection('cards').deleteMany({ cardUid: { $in: ['A49TEST0001', 'A49TEST0002', 'A49TEST0003', 'A49RACE0001'] } });

  await db.collection('users').insertMany([
    { _id: adminId, name: 'Matrix Admin', email: 'admin@matrix49.test', role: 'admin', status: 'active', ...base },
    { _id: targetId, name: 'Matrix Target', email: 'target@matrix49.test', role: 'customer', status: 'active', ...base },
    { _id: target2Id, name: 'Matrix Target 2', email: 'target2@matrix49.test', role: 'customer', status: 'active', ...base },
  ]);

  const token = (userId: unknown, role: string) => jwt.sign({ userId: String(userId), role }, secret, { expiresIn: '1h' });
  const ownerToken = token(owner._id, 'customer');
  const adminToken = token(adminId, 'admin');
  const targetToken = token(targetId, 'customer');

  let ip = 1;
  const api = async (tokenValue: string | null, method: string, url: string, body?: unknown) => {
    const headers: Record<string, string> = {
      'x-real-ip': `10.77.${Math.floor(ip / 250)}.${ip++ % 250}`,
      origin: BASE,
    };
    if (tokenValue) headers.cookie = `token=${tokenValue}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + url, {
      method, headers, redirect: 'manual',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json };
  };

  // ── Responsive Card Builder ──────────────────────────────────────────────
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'editor49-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9246',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      try { await (await fetch('http://127.0.0.1:9246/json/version')).json(); ready = true; break; }
      catch { await sleep(250); }
    }
    if (!ready) throw new Error('Chrome DevTools did not start');

    const target = await (await fetch('http://127.0.0.1:9246/json/new?about:blank', { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && pending.has(message.id)) {
        const entry = pending.get(message.id)!;
        pending.delete(message.id);
        message.error ? entry.reject(message.error) : entry.resolve(message.result);
      }
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression: string) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }) as {
        result?: { value?: unknown }; exceptionDetails?: { text?: string };
      };
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result?.value;
    };

    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.setCookie', { name: 'token', value: ownerToken, url: BASE, path: '/' });

    const tabIds: string[] = await (async () => {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: `${BASE}/dashboard/vcards/${String(premiumCard._id)}/edit` });
      for (let i = 0; i < 80; i += 1) {
        await sleep(200);
        const count = await evaluate(`document.querySelectorAll('[role="tab"]').length`).catch(() => 0);
        if (Number(count) > 0) break;
      }
      return await evaluate(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.id)`) as string[];
    })();

    if (tabIds.length !== 11) failures.push(`editor tab count ${tabIds.length}, expected 11`);

    for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
      for (const theme of ['dark', 'light'] as const) {
        await send('Emulation.setDeviceMetricsOverride', {
          width, height: width < 768 ? 900 : 1000, deviceScaleFactor: 1, mobile: width < 768,
        });
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        await send('Page.navigate', { url: `${BASE}/dashboard/vcards/${String(premiumCard._id)}/edit` });
        let readyEditor = false;
        for (let i = 0; i < 80; i += 1) {
          await sleep(200);
          const count = await evaluate(`document.querySelectorAll('[role="tab"]').length`).catch(() => 0);
          if (Number(count) === 11) { readyEditor = true; break; }
        }
        if (!readyEditor) { failures.push(`editor ${width}/${theme} not ready`); continue; }
        const metrics = await evaluate(`(() => {
          const vw = window.visualViewport?.width ?? window.innerWidth;
          const offenders = [...document.querySelectorAll('body *')]
            .map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, cls: String(el.className || '').slice(0, 80), right: Math.round(r.right), width: Math.round(r.width), inTablist: Boolean(el.closest('[role="tablist"]')) }; })
            .filter((row) => row.width > 0 && row.right > vw + 1 && !row.inTablist)
            .slice(0, 5);
          return {
            scrollWidth: document.documentElement.scrollWidth,
            vw,
            offenders,
            preview: (() => { const aside = document.querySelector('aside'); if (!aside) return false; const r = aside.getBoundingClientRect(); return r.width > 0; })(),
            tabs: document.querySelectorAll('[role="tab"]').length,
          };
        })()`) as { scrollWidth: number; vw: number; offenders: unknown[]; preview: boolean; tabs: number };
        if (metrics.scrollWidth > metrics.vw + 1) failures.push(`editor ${width}/${theme}: page overflow ${metrics.scrollWidth} > ${metrics.vw}`);
        if (metrics.offenders.length) failures.push(`editor ${width}/${theme}: elements beyond viewport`);
        if (width >= 1024 && !metrics.preview) failures.push(`editor ${width}/${theme}: desktop preview missing`);
        results.editor.push({ width, theme, ...metrics });
      }
    }

    // Every tab reachable at 320 and 1440; no overflow after switching.
    for (const width of [320, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await send('Page.navigate', { url: `${BASE}/dashboard/vcards/${String(premiumCard._id)}/edit` });
      for (let i = 0; i < 80; i += 1) {
        await sleep(200);
        const count = await evaluate(`document.querySelectorAll('[role="tab"]').length`).catch(() => 0);
        if (Number(count) === 11) break;
      }
      for (let index = 0; index < tabIds.length; index += 1) {
        const state = await evaluate(`(() => {
          const tabs = [...document.querySelectorAll('[role="tab"]')];
          const tab = tabs[${index}];
          if (!tab) return { clicked: false };
          tab.click();
          const vw = window.visualViewport?.width ?? window.innerWidth;
          return { clicked: true, label: tab.textContent?.trim(), selected: tab.getAttribute('aria-selected'), scrollWidth: document.documentElement.scrollWidth, vw };
        })()`) as { clicked: boolean; label?: string; selected?: string; scrollWidth?: number; vw?: number };
        await sleep(120);
        if (!state.clicked) failures.push(`tab ${index} missing at ${width}`);
        if ((state.scrollWidth ?? 0) > (state.vw ?? 0) + 1) failures.push(`tab ${state.label} overflow at ${width}`);
      }
    }

    // Keyboard reachability and focus visibility on the tab rail. The rail is
    // a plain button group (Tab-order navigation); there is no roving-tabindex
    // arrow-key pattern in this component, which is documented, not a
    // regression introduced by the width fix.
    const keyboard = await evaluate(`(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      tabs[0].focus();
      const focused = document.activeElement?.id;
      const allReachable = tabs.every((tab) => tab.tabIndex === 0 && tab.tagName === 'BUTTON');
      const focusRing = tabs.every((tab) => String(tab.className).includes('focus-visible:ring'));
      return { count: tabs.length, focused, allReachable, focusRing, firstIsBasic: focused === 'builder-tab-basic' };
    })()`) as { count: number; focused: string; allReachable: boolean; focusRing: boolean; firstIsBasic: boolean };
    if (keyboard.count !== 11) failures.push(`keyboard tab count ${keyboard.count}`);
    if (!keyboard.allReachable) failures.push('not every builder tab is keyboard reachable');
    if (!keyboard.focusRing) failures.push('builder tab focus ring missing');
    if (!keyboard.firstIsBasic) failures.push(`builder tab focus failed (${keyboard.focused})`);
    results.editor.push({ keyboard });

    ws.close();
  } finally {
    chrome.kill('SIGTERM');
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ── Duplicate UID activation ─────────────────────────────────────────────
  const catalogRes = await api(adminToken, 'GET', '/api/admin/catalog');
  const catalog = (catalogRes.json as { catalog?: Array<{ _id: string; slug: string }> }).catalog ?? [];
  const bySlug = new Map(catalog.map((item) => [item.slug, item._id]));
  const premiumId = bySlug.get('premium-nfc-card');
  const businessId = bySlug.get('business-nfc-card');
  const standeeId = bySlug.get('google-review-standee');
  if (!premiumId || !businessId || !standeeId) throw new Error(`catalog fixtures missing: ${[...bySlug.keys()].join(',')}`);

  const assign = (target: mongoose.Types.ObjectId, body: Record<string, unknown>) =>
    api(adminToken, 'POST', `/api/admin/users/${String(target)}/products`, body);

  // Existing contract: any non-empty trimmed UID up to 64 chars is accepted
  // literally (punctuation included); empty/omitted mints a DIGITAL card.
  const overlongUid = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'X'.repeat(65) });
  if (overlongUid.status !== 400) failures.push(`overlong UID status ${overlongUid.status}`);
  const missingUid = await assign(targetId, { catalogProductId: premiumId, quantity: 1 });
  const missingUidCard = (missingUid.json as { card?: { cardUid?: string } } | null)?.card?.cardUid ?? '';
  if (missingUid.status !== 201 || !missingUidCard.startsWith('DIGITAL-')) {
    failures.push(`missing UID digital card ${missingUid.status} ${missingUidCard}`);
  }

  const first = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49TEST0001' });
  if (first.status !== 201) failures.push(`first assignment ${first.status}: ${first.text.slice(0, 160)}`);
  const firstCardId = (first.json as { card?: { _id?: string } } | null)?.card?._id;

  const duplicate = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49TEST0001' });
  if (duplicate.status !== 409) failures.push(`duplicate same UID ${duplicate.status}`);
  const duplicateLower = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'a49test0001' });
  if (duplicateLower.status !== 409) failures.push(`duplicate lowercase UID ${duplicateLower.status}`);
  const crossCustomer = await assign(target2Id, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49TEST0001' });
  if (crossCustomer.status !== 409) failures.push(`cross-customer same UID ${crossCustomer.status}`);

  const second = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49TEST0002' });
  if (second.status !== 201) failures.push(`second different UID ${second.status}`);

  // Removed assignment may be re-added intentionally.
  const targetProducts = (await api(adminToken, 'GET', `/api/admin/users/${String(targetId)}/products`)).json as {
    products?: Array<{ _id: string; cardId?: string; status: string }>;
  };
  const firstAssignment = (targetProducts.products ?? []).find((row) => String(row.cardId) === String(firstCardId));
  if (!firstAssignment) failures.push('first assignment not listed');
  if (firstAssignment) {
    const removed = await api(adminToken, 'DELETE', `/api/admin/users/${String(targetId)}/products`, { userProductId: firstAssignment._id });
    if (removed.status !== 200) failures.push(`remove assignment ${removed.status}`);
    const reAdded = await assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49TEST0001' });
    if (reAdded.status !== 201) failures.push(`re-add removed UID ${reAdded.status}`);
  }

  const standee = await assign(targetId, { catalogProductId: standeeId, quantity: 1 });
  if (standee.status !== 201) failures.push(`standee assignment ${standee.status}`);

  const lower = await assign(targetId, { catalogProductId: businessId, quantity: 1, cardUid: 'A49TEST0003' });
  if (lower.status !== 201) failures.push(`lower-tier assignment ${lower.status}`);
  const lowerCardId = (lower.json as { card?: { _id?: string } } | null)?.card?._id;

  // Concurrency: an unassigned card claimed by two simultaneous requests.
  const raceId = oid();
  await db.collection('cards').insertOne({
    _id: raceId, cardUid: 'A49RACE0001', slug: 'a49race0001', routeSlug: 'routerace49', uid: 'routerace49',
    name: 'A49RACE0001', kind: 'profile', status: 'unassigned', isActive: false, setupComplete: false,
    createdAt: now, updatedAt: now,
  });
  const [raceA, raceB] = await Promise.all([
    assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49RACE0001' }),
    assign(targetId, { catalogProductId: premiumId, quantity: 1, cardUid: 'A49RACE0001' }),
  ]);
  const raceActive = await db.collection('userproducts').countDocuments({ cardId: raceId, status: 'active' });
  if (raceActive > 1) failures.push(`concurrent duplicate active assignments: ${raceActive}`);
  results.activation = {
    overlongUid: overlongUid.status,
    missingUid: { status: missingUid.status, cardUid: missingUidCard },
    first: first.status,
    firstCardId,
    duplicate: duplicate.status,
    duplicateLower: duplicateLower.status,
    crossCustomer: crossCustomer.status,
    second: second.status,
    standee: standee.status,
    lower: lower.status,
    race: { a: raceA.status, b: raceB.status, activeAssignments: raceActive },
  };

  // No duplicate active records for the sequentially assigned UID.
  const premiumDuplicates = await db.collection('userproducts').countDocuments({
    userId: targetId,
    cardId: new mongoose.Types.ObjectId(String(firstCardId)),
    status: 'active',
  });
  if (premiumDuplicates !== 1) failures.push(`sequential duplicate records ${premiumDuplicates}`);
  results.activation.premiumActiveRecords = premiumDuplicates;

  // Entitlement after activation: Premium review-capable, Business restricted.
  const myProducts = (await api(targetToken, 'GET', '/api/my/products')).json as { products?: Array<Record<string, unknown>> };
  const names = (myProducts.products ?? []).map((row) => String((row as { catalogProduct?: { name?: string } }).catalogProduct?.name ?? ''));
  const reviewProducts = (await api(targetToken, 'GET', '/api/review-management/products')).json as {
    products?: Array<{ catalogProductSlug?: string }>;
  };
  const reviewSlugs = (reviewProducts.products ?? []).map((row) => String(row.catalogProductSlug ?? ''));
  if (!names.includes('Premium NFC Card')) failures.push('Premium missing from My Products');
  if (!names.includes('Google Review Standee')) failures.push('Standee missing from My Products');
  if (reviewSlugs.includes('business-nfc-card')) failures.push('lower-tier card exposed in review products');
  const lowerEntitlement = lowerCardId
    ? (await api(targetToken, 'GET', `/api/cards/${String(lowerCardId)}/review-entitlement`)).json
    : null;
  results.activation.myProducts = names;
  results.activation.reviewProducts = reviewSlugs;
  results.activation.lowerEntitlement = lowerEntitlement;

  console.log(JSON.stringify({ failures, results }, null, 2));
  await mongoose.disconnect();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
