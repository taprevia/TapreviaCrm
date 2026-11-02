/**
 * PVC UI removal — local API + browser verification.
 *
 * Requires a seeded local server (DB `taprevia_p39_pvc`) on :3520.
 * No production access, no real data.
 */

import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';

const BASE = process.env.PVC_BASE || 'http://localhost:3520';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const ADMIN = '000000000000000000000001';
const DISPOSABLE = '000000000000000000000004';
const PREM_ASSIGN = '000000000000000000000401';
const BIZ_CATALOG = '000000000000000000000102';
const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign({ userId: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results: Array<{ id: string; name: string; pass: boolean; evidence: string }> = [];
let ip = 0;
const nextIp = () => `10.98.${Math.floor(ip / 200)}.${(ip++ % 200) + 1}`;

function record(id: string, name: string, pass: boolean, evidence: string) {
  results.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${evidence}`);
}

async function api(method: string, route: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': nextIp(), 'content-type': 'application/json' };
  if (opts.token) { headers.cookie = `token=${opts.token}`; headers.origin = BASE; }
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}

async function main() {
  if (!process.env.MONGODB_DB?.includes('pvc')) throw new Error('Refusing non-pvc DB');
  await mongoose.connect(`mongodb://localhost:27017/${process.env.MONGODB_DB}`);

  // API: existing PVC material remains readable.
  {
    const r = await api('GET', '/api/my/products', { token: ownerToken });
    const body = r.json as { products?: Array<{ assignmentId: string; material?: string }> };
    const prem = body.products?.find((p) => p.assignmentId === PREM_ASSIGN);
    record('PVC-API-1', 'Existing PVC material remains readable internally', r.status === 200 && prem?.material === 'pvc', `status=${r.status} material=${prem?.material}`);
  }

  // Rename an unrelated field; material must not change.
  {
    const r = await api('PATCH', `/api/my/products/${PREM_ASSIGN}`, {
      token: ownerToken,
      body: { title: 'Legacy Premium Renamed' },
    });
    const doc = await mongoose.connection.collection('userproducts').findOne({ _id: new mongoose.Types.ObjectId(PREM_ASSIGN) });
    record('PVC-API-2', 'Editing unrelated fields preserves stored PVC', r.status === 200 && doc?.material === 'pvc', `status=${r.status} material=${doc?.material}`);
  }

  // New assignment rejects PVC; valid/omitted materials succeed.
  {
    const pvc = await api('POST', `/api/admin/users/${DISPOSABLE}/products`, {
      token: adminToken,
      body: { catalogProductId: BIZ_CATALOG, material: 'pvc' },
    });
    const metal = await api('POST', `/api/admin/users/${DISPOSABLE}/products`, {
      token: adminToken,
      body: { catalogProductId: BIZ_CATALOG, material: 'metal' },
    });
    const omitted = await api('POST', `/api/admin/users/${DISPOSABLE}/products`, {
      token: adminToken,
      body: { catalogProductId: BIZ_CATALOG },
    });
    const rows = await mongoose.connection.collection('userproducts')
      .find({ userId: new mongoose.Types.ObjectId(DISPOSABLE) })
      .toArray();
    const newRows = rows.filter((row) => row.material === 'metal' || row.material === undefined);
    record(
      'PVC-API-3',
      'New assignment rejects PVC; metal/omitted remain allowed',
      pvc.status === 400 && metal.status === 201 && omitted.status === 201 && newRows.length >= 2 && !rows.some((row) => row.material === 'pvc'),
      `pvc=${pvc.status} metal=${metal.status} omitted=${omitted.status} rows=${rows.length}`
    );
  }

  // NFC route still resolves.
  {
    const r = await api('GET', '/r/route-p35-premium');
    record('PVC-NFC', 'Existing printed NFC route still redirects', r.status === 307, `status=${r.status} location=${r.headers.get('location') ?? 'none'}`);
  }

  // Admin catalog dropdown: a legacy PVC catalog row must not be offered.
  {
    await mongoose.connection.collection('catalogproducts').insertOne({
      _id: new mongoose.Types.ObjectId('000000000000000000000777'),
      slug: 'pvc-card',
      name: 'PVC Card',
      category: 'card',
      kind: 'profile',
      active: true,
      priceMinor: 0,
      sortOrder: 99,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const r = await api('GET', '/api/admin/catalog', { token: adminToken });
    const body = r.json as { catalog?: Array<{ slug?: string; name?: string }> };
    const catalog = body.catalog ?? [];
    record(
      'PVC-API-4',
      'Legacy PVC catalog row is hidden from new assignment options',
      r.status === 200 && catalog.length > 0 && !catalog.some((p) => /^pvc(?:\s|$|-)/i.test(String(p.slug ?? p.name ?? ''))),
      `status=${r.status} catalog=${catalog.length}`
    );
  }

  // Browser text checks.
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvcui-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9280', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i += 1) {
      try { await (await fetch('http://127.0.0.1:9280/json/version')).json(); break; } catch { await sleep(200); }
    }
    const target = (await (await fetch('http://127.0.0.1:9280/json/new?about:blank', { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp')); });
    let id = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number; result?: unknown; error?: unknown };
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
    const goto = async (route: string, token: string) => {
      await send('Network.clearBrowserCookies');
      await send('Network.setCookie', { name: 'token', value: token, url: BASE, path: '/' });
      await send('Page.navigate', { url: `${BASE}${route}` });
      await sleep(1800);
    };
    const text = () => ev<string>('document.body.innerText');

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });

    await goto('/dashboard/products', ownerToken);
    const customerText = await text();
    record(
      'PVC-UI-1',
      'Customer products page hides PVC but keeps product and other material',
      !/pvc/i.test(customerText) && /Legacy Premium Renamed|Premium NFC Card/i.test(customerText) && /Metal/i.test(customerText),
      `pvc=${/pvc/i.test(customerText)} metal=${/Metal/i.test(customerText)}`
    );

    await goto(`/admin/users/${OWNER}`, adminToken);
    const adminText = await text();
    record(
      'PVC-UI-2',
      'Admin user details hides PVC and keeps product records',
      !/pvc/i.test(adminText) && /Premium NFC Card|Legacy Premium Renamed/i.test(adminText),
      `pvc=${/pvc/i.test(adminText)}`
    );

    await goto('/admin/products', adminToken);
    const adminProductsText = await text();
    record('PVC-UI-3', 'Admin products page contains no PVC', !/pvc/i.test(adminProductsText), `pvc=${/pvc/i.test(adminProductsText)}`);

    await goto('/', '');
    const homeText = await text();
    record('PVC-UI-4', 'Customer website contains no PVC product/label', !/pvc/i.test(homeText) && /Business NFC Card/i.test(homeText), `pvc=${/pvc/i.test(homeText)}`);

    const failed = results.filter((r) => !r.pass);
    console.log('\n=== PVC UI/API SUMMARY ===');
    console.log(JSON.stringify({ checks: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
    ws.close();
    await mongoose.disconnect();
    process.exit(failed.length === 0 ? 0 : 1);
  } finally {
    chrome.kill('SIGTERM');
    await sleep(200);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
