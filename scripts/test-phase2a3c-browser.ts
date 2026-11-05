/**
 * Phase 2A-3C browser verification via installed Chrome + CDP.
 * No dependency installation. Synthetic local data only.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

const DB_URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB_NAME = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A3C_JWT_SECRET ?? '';
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'NOT EXECUTED'; detail?: string }> = [];
const profileDir = mkdtempSync(join(tmpdir(), 'p2a3chrome-'));
const downloadDir = mkdtempSync(join(tmpdir(), 'p2a3download-'));
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let chrome: ReturnType<typeof spawn> | null = null;
let cdp: Cdp;
let client: MongoClient;

class Cdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  constructor(url: string) {
    this.ws = new WebSocket(url);
  }
  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(e), { once: true });
    });
    this.ws.addEventListener('message', (event: MessageEvent) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    });
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws.close(); }
}

async function evaluate(expression: string): Promise<any> {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Runtime.evaluate failed');
  return res.result?.value;
}
async function waitFor(expression: string, timeoutMs = 20000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function setCookie(value: string): Promise<void> {
  await cdp.send('Network.clearBrowserCookies');
  await cdp.send('Network.setCookie', {
    name: 'token', value, url: BASE, path: '/', httpOnly: true, sameSite: 'Lax',
  });
}
async function navigate(path: string): Promise<void> {
  await cdp.send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor("document.readyState === 'complete'");
}
function decodePng(file: string): string {
  const py = [
    'import cv2, sys',
    'img=cv2.imread(sys.argv[1])',
    'v,_,_=cv2.QRCodeDetector().detectAndDecode(img)',
    'print(v)',
  ].join('\n');
  return execFileSync('python3', ['-c', py, file], { encoding: 'utf8' }).trim();
}
function saveDataUrl(dataUrl: string, file: string): void {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(file, Buffer.from(b64, 'base64'));
}
function waitForDownload(before: string[]): string | null {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const files = readdirSync(downloadDir).filter((f) => !before.includes(f) && !f.endsWith('.crdownload'));
    if (files.length) return join(downloadDir, files[0]);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  return null;
}
function decodePdfQr(pdfPath: string): string {
  const png = pdfPath.replace(/\.pdf$/i, '') + '.png';
  try {
    execFileSync('sips', ['-s', 'format', 'png', pdfPath, '--out', png], { stdio: 'ignore' });
    if (existsSync(png)) {
      const v = decodePng(png);
      if (v) return v;
    }
  } catch {}
  try {
    const outDir = mkdtempSync(join(tmpdir(), 'p2a3ql-'));
    execFileSync('qlmanage', ['-t', '-s', '1200', '-o', outDir, pdfPath], { stdio: 'ignore' });
    const files = readdirSync(outDir);
    if (files.length) return decodePng(join(outDir, files[0]));
  } catch {}
  return '';
}

async function test(id: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`PASS ${id}`); }
  catch (e) { results.push({ id, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) }); console.log(`FAIL ${id} — ${results[results.length - 1].detail}`); }
}

async function main() {
  if (BASE !== 'http://127.0.0.1:3211') throw new Error('BLOCKED — wrong browser base');
  if (DB_URI !== 'mongodb://127.0.0.1:27038') throw new Error('BLOCKED — wrong DB URI');
  if (!/^taprevia_phase2a3c_head_[a-z0-9_]+$/.test(DB_NAME)) throw new Error('BLOCKED — wrong DB');
  if (SECRET.length < 24) throw new Error('BLOCKED — missing JWT secret');

  client = new MongoClient(DB_URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(DB_NAME);
  const acme = await db.collection('users').findOne({ bizSlug: 'acme' });
  const admin = await db.collection('users').findOne({ email: 'admin@test.local' });
  assert.ok(acme && admin);
  const acmeToken = jwt.sign({ userId: String(acme._id), role: 'customer' }, SECRET, { expiresIn: '1h' });
  const adminToken = jwt.sign({ userId: String(admin._id), role: 'admin' }, SECRET, { expiresIn: '1h' });

  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=9223', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,1000',
    '--disable-background-networking', 'about:blank',
  ], { stdio: 'ignore' });

  const deadline = Date.now() + 15000;
  let version: any = null;
  while (Date.now() < deadline) {
    try { version = await (await fetch('http://127.0.0.1:9223/json/version')).json(); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!version) throw new Error('Chrome CDP did not start');
  const list = await (await fetch('http://127.0.0.1:9223/json/list')).json();
  const page = list.find((t: any) => t.type === 'page');
  if (!page) throw new Error('No Chrome page target');
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  try { await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir }); } catch {}
  try { await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true }); } catch {}

  // ── T73 Admin Total Visits + QR preview ─────────────────────────────────
  await test('T73 admin Total Visits tile and QR previews', async () => {
    await setCookie(adminToken);
    await navigate(`/admin/users/${String(acme._id)}`);
    await waitFor("document.body.innerText.includes('Total Visits')");
    const body = await evaluate('document.body.innerText');
    assert.match(body, /Total Visits/);
    assert.match(body, /Taps \(newest card\)/);
    const newest = body.match(/Newest card:\s*(\/[^\s]+)/);
    assert.ok(newest, 'newest card URL missing');
    const slug = String(newest[1]).replace(/^\//, '');
    const newestCard = await db.collection('cards').findOne({ publicSlug: slug });
    assert.ok(newestCard, `newest card not found for ${slug}`);
    const expectedVisits = await db.collection('analyticslogs').countDocuments({ action: 'public_visit', cardId: newestCard._id });
    const tile = body.match(/(\d+)\s*Total Visits/);
    assert.ok(tile, 'Total Visits tile value missing');
    assert.equal(Number(tile[1]), expectedVisits, `admin tile ${tile[1]} != DB ${expectedVisits}`);

    await waitFor("document.querySelectorAll('img[alt*=\"QR code for card\"]').length > 0");
    const cardImgs = await evaluate(`Array.from(document.querySelectorAll('img[alt*="QR code for card"]')).map(i => ({alt:i.alt, src:i.src}))`);
    assert.ok(cardImgs.length > 0);
    const cardImg = cardImgs.find((i: any) => i.alt.includes('business-card')) ?? cardImgs[0];
    saveDataUrl(cardImg.src, '/tmp/p2a3browser-admin-card.png');
    const cardSlug = String(cardImg.alt).replace(/^.*card\s+/, '').trim();
    const cardDoc = await db.collection('cards').findOne({ slug: cardSlug });
    assert.ok(cardDoc, `admin QR card not found: ${cardSlug}`);
    assert.equal(decodePng('/tmp/p2a3browser-admin-card.png'), `${BASE}/${cardDoc.publicSlug}`);

    await waitFor("document.querySelectorAll('img[alt*=\"Permanent QR code for standee\"]').length > 0");
    const standeeImgs = await evaluate(`Array.from(document.querySelectorAll('img[alt*="Permanent QR code for standee"]')).map(i => ({alt:i.alt, src:i.src}))`);
    const standeeImg = standeeImgs.find((i: any) => i.alt.includes('Standard')) ?? standeeImgs[0];
    saveDataUrl(standeeImg.src, '/tmp/p2a3browser-admin-standee.png');
    const standeeName = String(standeeImg.alt).replace(/^.*standee\s+/, '').trim();
    const standeeDoc = await db.collection('standees').findOne({
      $or: [{ displayName: standeeName }, { name: standeeName }],
    });
    assert.ok(standeeDoc, `admin QR standee not found: ${standeeName}`);
    assert.equal(decodePng('/tmp/p2a3browser-admin-standee.png'), `${BASE}/${standeeDoc.publicSlug}`);

    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r: any) => writeFileSync('/tmp/p2a3browser-admin-desktop.png', Buffer.from(r.data, 'base64')));
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2');
    assert.equal(overflow, false, 'admin desktop horizontal overflow');
  });

  // ── T74 Customer Total Visits ───────────────────────────────────────────
  await test('T74 customer Total Visits tile and coverage note', async () => {
    await setCookie(acmeToken);
    await navigate('/dashboard/analytics');
    await waitFor("document.querySelector('select') !== null");
    const visitedCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.ok(visitedCard);
    const targetKey = `card:${String(visitedCard._id)}`;
    await waitFor(`Array.from(document.querySelectorAll('select option')).some(o => o.value === ${JSON.stringify(targetKey)})`);
    await evaluate(`(() => { const s = document.querySelector('select'); s.value = ${JSON.stringify(targetKey)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
    await waitFor("document.body.innerText.includes('TOTAL VISITS') && document.body.innerText.includes('CARD TAPS')", 30000);
    const body = await evaluate('document.body.innerText');
    assert.match(body, /TOTAL VISITS/);
    assert.match(body, /CARD TAPS/);
    assert.match(body, /Total Visits counts all public entries recorded from Phase 2A-3C onward/);
    const tile = body.match(/TOTAL VISITS\s+(\d+)/i);
    assert.ok(tile, 'Total Visits value missing');
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const expected = await db.collection('analyticslogs').countDocuments({
      action: 'public_visit', cardId: visitedCard._id, createdAt: { $gte: since },
    });
    assert.equal(Number(tile[1]), expected, `customer tile ${tile[1]} != DB ${expected}`);
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r: any) => writeFileSync('/tmp/p2a3browser-customer-desktop.png', Buffer.from(r.data, 'base64')));
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2');
    assert.equal(overflow, false, 'customer desktop horizontal overflow');
  });

  // ── T82 Customer QR preview/download ────────────────────────────────────
  await test('T82 customer QR preview and PDF download', async () => {
    await setCookie(acmeToken);
    await navigate('/dashboard/vcards');
    await waitFor("Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'QR')");
    await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'QR'); b.click(); return true; })()`);
    await waitFor("document.querySelector('img[alt^=\"QR code for\"]') !== null");
    const img = await evaluate(`(() => { const i = document.querySelector('img[alt^="QR code for"]'); return {alt:i.alt, src:i.src}; })()`);
    saveDataUrl(img.src, '/tmp/p2a3browser-customer-card.png');
    const decoded = decodePng('/tmp/p2a3browser-customer-card.png');
    assert.match(decoded, new RegExp(`^${BASE}/`), `unexpected customer QR ${decoded}`);
    const modalText = await evaluate('document.body.innerText');
    assert.ok(modalText.includes(decoded), 'modal display URL does not match decoded QR');

    const before = readdirSync(downloadDir);
    await evaluate(`(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Download PDF')); if (!b) return false; b.click(); return true; })()`);
    const file = waitForDownload(before);
    assert.ok(file, 'customer QR PDF download missing');
    assert.ok(readFileSync(file).length > 0);
    const pdfQr = decodePdfQr(file);
    assert.equal(pdfQr, decoded, 'downloaded PDF QR does not match preview');
  });

  // ── T80/T81 Desktop/Mobile ──────────────────────────────────────────────
  await test('T80 desktop layout and QR preview', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await setCookie(acmeToken);
    await navigate('/dashboard/vcards');
    await waitFor("Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'QR')");
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2');
    assert.equal(overflow, false);
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r: any) => writeFileSync('/tmp/p2a3browser-desktop.png', Buffer.from(r.data, 'base64')));
  });

  await test('T81 mobile layout and QR controls', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await setCookie(acmeToken);
    await navigate('/dashboard/analytics');
    await waitFor("document.body.innerText.includes('Total Visits')");
    const overflow = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2');
    assert.equal(overflow, false, 'mobile horizontal overflow');
    await navigate('/dashboard/vcards');
    await waitFor("Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'QR')");
    const overflow2 = await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2');
    assert.equal(overflow2, false, 'mobile vcards horizontal overflow');
    await cdp.send('Page.captureScreenshot', { format: 'png' }).then((r: any) => writeFileSync('/tmp/p2a3browser-mobile.png', Buffer.from(r.data, 'base64')));
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, results }, null, 2));
  await client.close();
  cdp.close();
  chrome.kill();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`BROWSER TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  try { cdp?.close(); } catch {}
  try { chrome?.kill(); } catch {}
  process.exit(1);
});
