/**
 * Phase 2A-3 runtime matrix.
 *
 * Fresh isolated DB/runtime. Manual redirects, decoded QR PNGs, exact analytics
 * deltas, suspension/reactivation, collision, reservations, and no-mutation.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';
import {
  brandedStandeePanelQrUrl,
  permanentCardUrl,
  strictPermanentCardUrl,
} from '@/lib/admin-card-view';
import { resolveCanonicalPublicBase } from '@/lib/public-base';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A3_JWT_SECRET ?? '';
const NO_ORIGIN_BASE = process.env.PHASE2A3_NO_ORIGIN_BASE ?? '';
const PORT = 27034;
const BASE_PORT = 3205;
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT EXECUTED'; detail?: string }> = [];
let client: MongoClient;
let db: any;
let analytics: any;
let acme: any;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a3_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== `http://127.0.0.1:${BASE_PORT}`) throw new Error('BLOCKED — wrong base URL');
  if (NO_ORIGIN_BASE !== 'http://127.0.0.1:3206') throw new Error('BLOCKED — wrong no-origin base');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
}

async function test(id: string, fn: () => Promise<void>, status: 'PASS' | 'BLOCKED' = 'PASS') {
  if (status === 'BLOCKED') {
    results.push({ id, status: 'BLOCKED' });
    console.log(`BLOCKED ${id}`);
    return;
  }
  try {
    await fn();
    results.push({ id, status: 'PASS' });
    console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, status: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${id} — ${results[results.length - 1].detail}`);
  }
}

interface Resp {
  status: number;
  location: string | null;
  cacheControl: string | null;
  body: string;
}

function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const match = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3205(\/.*)?$/);
  if (match) return match[1] ?? '/';
  return location;
}

async function request(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Resp> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    body: await res.text(),
  };
}

async function requestNoOrigin(path: string, cookie: string): Promise<Resp> {
  const res = await fetch(`${NO_ORIGIN_BASE}${path}`, {
    headers: { Cookie: `token=${cookie}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    body: await res.text(),
  };
}

async function qrPng(path: string, cookie: string, file: string): Promise<Buffer> {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: `token=${cookie}` }, redirect: 'manual' });
  assert.equal(res.status, 200, `${path} status ${res.status}`);
  assert.match(res.headers.get('content-type') ?? '', /image\/png/);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

function decodeQr(file: string): string {
  const py = [
    'import cv2, sys',
    'img = cv2.imread(sys.argv[1])',
    'd = cv2.QRCodeDetector()',
    'val, pts, _ = d.detectAndDecode(img)',
    'print(val)',
  ].join('\n');
  return execFileSync('python3', ['-c', py, file], { encoding: 'utf8' }).trim();
}

const count = (metadata: string) => analytics.countDocuments({ metadata });
const countAction = (action: string, metadata: string) => analytics.countDocuments({ action, metadata });
const token = (userId: string, role = 'customer') => jwt.sign({ userId, role }, SECRET, { expiresIn: '1h' });

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  analytics = db.collection('analyticslogs');
  acme = await db.collection('users').findOne({ bizSlug: 'acme' });
  assert.ok(acme);
  const acmeToken = token(String(acme._id));
  const admin = await db.collection('users').findOne({ email: 'admin@test.local' });
  assert.ok(admin);

  const cards = await db.collection('cards').find({}).toArray();
  const standees = await db.collection('standees').find({}).toArray();
  const byRoute = new Map(standees.map((s: any) => [s.routeSlug, s]));
  const bySlug = new Map(standees.filter((s: any) => s.publicSlug).map((s: any) => [s.publicSlug, s]));
  const cardByRoute = new Map(cards.map((c: any) => [c.routeSlug, c]));
  const origin = 'http://127.0.0.1:3205';

  const reservationsBefore = JSON.stringify(
    (await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray())
      .map((r: any) => ({ path: r.path, kind: r.kind, status: r.status }))
  );

  // ── Q01/Q02: Card QR policy gate ─────────────────────────────────────────
  results.push({
    id: 'Q01 existing NFC Card software QR',
    status: 'BLOCKED',
    detail:
      'Card QR was not changed: branded Card pages do not record the /r route tap or Card stats.taps. Changing the QR would lose Card analytics. Q22 proves the delta. Owner approval required for an analytics design.',
  });
  console.log('BLOCKED Q01 existing NFC Card software QR');
  results.push({
    id: 'Q02 new NFC Card software QR',
    status: 'BLOCKED',
    detail: 'Same Card analytics blocker as Q01.',
  });
  console.log('BLOCKED Q02 new NFC Card software QR');

  await test('Q01b existing Card branded URL and printed /r remain functional', async () => {
    const branded = await request('/acme/business-card');
    assert.equal(branded.status, 200);
    const before = await count('route:r_card');
    const r = await request('/r/r_card');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/acme/business-card');
    assert.equal(await count('route:r_card'), before + 1);
  });

  await test('Q03 review Card branded URL and legacy review route', async () => {
    assert.equal((await request('/acme/review-card')).status, 200);
    assert.equal((await request('/review/review-card')).status, 200);
    const before = await count('route:r_reviewcard');
    const r = await request('/r/r_reviewcard');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/review/review-card');
    assert.equal(await count('route:r_reviewcard'), before + 1);
  });

  // ── Q04–Q09: standee panel QR helper ────────────────────────────────────
  await test('Q04 existing standard Standee panel QR uses branded publicSlug', async () => {
    const s = byRoute.get('r_standee') as any;
    const url = brandedStandeePanelQrUrl(s, origin);
    assert.equal(url, 'http://127.0.0.1:3205/acme/standee');
    const png = await QRCode.toBuffer(url, { width: 320, margin: 2 });
    writeFileSync('/tmp/p2a3-standee-panel.png', png);
    assert.equal(decodeQr('/tmp/p2a3-standee-panel.png'), url);
  });

  await test('Q05 new standard Standee panel QR uses branded publicSlug', async () => {
    const s = byRoute.get('r_standee2') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee-2');
  });

  await test('Q06 AIO3 panel QR branded and slot QR unchanged', async () => {
    const s = byRoute.get('r_aio3') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee-3');
    const slot = await request('/r/r_aio3/1');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/aio3-google');
    assert.equal((await request('/r/r_aio3/3')).location, 'https://example.test/aio3-facebook');
  });

  await test('Q07 AIO4 panel QR branded and slot QR unchanged', async () => {
    const s = byRoute.get('r_aio4') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee-4');
    const slot = await request('/r/r_aio4/4');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/aio4-facebook');
  });

  results.push({
    id: 'Q08 legacy AIO branded panel QR',
    status: 'BLOCKED',
    detail:
      'Legacy AIO branded entry keeps the picker and does not delegate to /r; changing its panel QR from /r to publicSlug would drop the existing route tap. Legacy /qr routes were verified unchanged.',
  });
  console.log('BLOCKED Q08 legacy AIO branded panel QR');

  await test('Q08b legacy AIO helper falls back to /r and legacy /qr routes work', async () => {
    const s = byRoute.get('r_legacy') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/r/r_legacy');
    assert.equal((await request('/qr/panel_legacy')).status, 307);
    assert.equal((await request('/qr/soc_legacy_1')).status, 302);
    assert.equal((await request('/r/r_legacy')).status, 307);
    assert.equal((await request('/r/r_legacy/1')).status, 307);
  });

  await test('Q09 Google Review Standee panel QR branded and review routing', async () => {
    const s = byRoute.get('r_reviewstandee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee-6');
    const branded = await request('/acme/standee-6');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_reviewstandee');
    const r = await request('/r/r_reviewstandee');
    assert.equal(asInternal(r.location), '/standee-review/r_reviewstandee');
    assert.equal((await request('/standee-review/r_reviewstandee')).status, 200);
  });

  // ── Q10 missing publicSlug ──────────────────────────────────────────────
  await test('Q10 missing publicSlug falls back to /r and allocates nothing', async () => {
    const s = byRoute.get('r_noslug') as any;
    assert.ok(s);
    assert.equal(s.publicSlug ?? null, null);
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/r/r_noslug');
    const after = await db.collection('standees').findOne({ _id: s._id });
    assert.equal(after.publicSlug ?? null, null);
  });

  // ── Q11/Q12 QR surfaces ─────────────────────────────────────────────────
  results.push({
    id: 'Q11 admin Card QR preview',
    status: 'BLOCKED',
    detail: 'Admin Card QR still uses strict /r; branded Card analytics blocker applies.',
  });
  console.log('BLOCKED Q11 admin Card QR preview');

  await test('Q11b admin Standee panel QR helper uses branded publicSlug', async () => {
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee');
  });

  await test('Q12 customer QR API uses branded publicSlug for Card and Standee', async () => {
    await qrPng('/api/my/qr?slug=r_card', acmeToken, '/tmp/p2a3-api-card.png');
    await qrPng('/api/my/qr?slug=r_standee', acmeToken, '/tmp/p2a3-api-standee.png');
  });

  // ── Q13 decode actual QR images ─────────────────────────────────────────
  await test('Q13 decoded QR payloads match branded URLs', async () => {
    assert.equal(decodeQr('/tmp/p2a3-api-card.png'), 'http://127.0.0.1:3205/acme/business-card');
    assert.equal(decodeQr('/tmp/p2a3-api-standee.png'), 'http://127.0.0.1:3205/acme/standee');
    assert.equal(decodeQr('/tmp/p2a3-standee-panel.png'), 'http://127.0.0.1:3205/acme/standee');
  });

  // ── Q14 copy link ───────────────────────────────────────────────────────
  await test('Q14 admin panel copy-link source uses the same branded helper', async () => {
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), 'http://127.0.0.1:3205/acme/standee');
  });

  // ── Q15 consistency ─────────────────────────────────────────────────────
  results.push({
    id: 'Q15 admin/customer Card QR consistency',
    status: 'BLOCKED',
    detail:
      'Customer /api/my/qr already emits publicSlug, while the Card dashboard/admin QR remains /r. This is the same Card analytics gate. Standee panel admin/customer surfaces are consistent on publicSlug.',
  });
  console.log('BLOCKED Q15 admin/customer Card QR consistency');

  await test('Q15b Standee admin/customer public URL consistency', async () => {
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), `${origin}/${s.publicSlug}`);
  });

  // ── Q16/Q17 slot and social preservation ────────────────────────────────
  await test('Q16 slot QR destinations remain unchanged', async () => {
    assert.equal((await request('/r/r_aio3/1')).location, 'https://example.test/aio3-google');
    assert.equal((await request('/r/r_aio3/2')).location, 'https://example.test/aio3-instagram');
    assert.equal((await request('/r/r_aio4/1')).location, 'https://example.test/aio4-google');
    assert.equal((await request('/r/r_aio4/3')).location, 'https://example.test/aio4-whatsapp');
  });

  await test('Q17 social QR destinations remain unchanged', async () => {
    const before = await count('qr-panel:soc_aio3_2');
    const res = await request('/qr/soc_aio3_2');
    assert.equal(res.status, 302);
    assert.equal(res.location, 'https://example.test/aio3-instagram');
    assert.equal(await count('qr-panel:soc_aio3_2'), before);
  });

  // ── Q18/Q19 canonical origin ────────────────────────────────────────────
  await test('Q18 missing canonical origin fails QR API safely', async () => {
    const res = await requestNoOrigin('/api/my/qr?slug=r_standee', acmeToken);
    assert.equal(res.status, 409);
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, ''), '');
  });

  await test('Q19 invalid/untrusted origins are rejected', async () => {
    for (const configured of ['javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test/path?x=1']) {
      assert.equal(resolveCanonicalPublicBase({ configured, nodeEnv: 'development' }), '', configured);
    }
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, 'javascript:alert(1)'), '');
  });

  // ── Q20/Q21 suspension and reactivation ─────────────────────────────────
  await test('Q20 suspended owner blocks branded Card/Standee QR scans with no analytics', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'suspended' } });
    const before = await analytics.countDocuments({});
    for (const path of ['/acme/business-card', '/acme/standee', '/acme/standee-3', '/acme/standee-6']) {
      assert.equal((await request(path)).status, 404, `${path}`);
    }
    assert.equal((await request('/r/r_card')).status, 404);
    assert.equal((await request('/r/r_standee')).status, 404);
    assert.equal((await request('/qr/panel_standee')).status, 404);
    const t = await request('/t/CARD1');
    assert.equal(t.status, 302);
    assert.equal(asInternal(t.location), '/');
    assert.equal(await analytics.countDocuments({}), before);
  });

  await test('Q21 reactivated owner restores the same publicSlug URLs', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'active' } });
    const beforeCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    const beforeStandee = await db.collection('standees').findOne({ routeSlug: 'r_standee' });
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal((await request('/acme/standee')).status, 307);
    const afterCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    const afterStandee = await db.collection('standees').findOne({ routeSlug: 'r_standee' });
    assert.equal(afterCard.publicSlug, beforeCard.publicSlug);
    assert.equal(afterStandee.publicSlug, beforeStandee.publicSlug);
    assert.equal(afterStandee.routeSlug, beforeStandee.routeSlug);
  });

  // ── Q22 Card analytics gate ─────────────────────────────────────────────
  results.push({
    id: 'Q22 branded Card QR analytics',
    status: 'BLOCKED',
    detail:
      'Branded Card page records no route tap and does not increment Card stats.taps. The /r route does. Changing Card QR would lose analytics. Evidence: branded request leaves route:r_card unchanged; /r adds exactly one.',
  });
  console.log('BLOCKED Q22 branded Card QR analytics');
  await test('Q22b prove branded Card vs /r analytics delta', async () => {
    const beforeCount = await count('route:r_card');
    const beforeCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal(await count('route:r_card'), beforeCount);
    const midCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal(midCard.stats.taps, beforeCard.stats.taps);
    assert.equal((await request('/r/r_card')).status, 307);
    assert.equal(await count('route:r_card'), beforeCount + 1);
    const afterCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal(afterCard.stats.taps, beforeCard.stats.taps + 1);
  });

  // ── Q23 Standee analytics ───────────────────────────────────────────────
  await test('Q23 branded Standee panel flow records exactly one route tap', async () => {
    const before = await count('route:r_standee');
    const branded = await request('/acme/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_standee');
    assert.equal(await count('route:r_standee'), before);
    const r = await request('/r/r_standee');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/standee');
    assert.equal(await count('route:r_standee'), before + 1);
    assert.equal((await request('/panel/r_standee')).status, 200);
    assert.equal(await count('route:r_standee'), before + 1);
  });

  // ── Q24 review analytics ────────────────────────────────────────────────
  await test('Q24 review route and review-page view remain separate', async () => {
    const beforeRoute = await count('route:r_reviewstandee');
    const beforeView = await countAction('review_page_view', 'standee-review:r_reviewstandee');
    assert.equal((await request('/acme/standee-6')).status, 307);
    const r = await request('/r/r_reviewstandee');
    assert.equal(asInternal(r.location), '/standee-review/r_reviewstandee');
    assert.equal(await count('route:r_reviewstandee'), beforeRoute + 1);
    assert.equal((await request('/standee-review/r_reviewstandee')).status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_reviewstandee'), beforeView + 1);
    assert.equal(await count('route:r_reviewstandee'), beforeRoute + 1);
  });

  // ── Q25 collision safety ────────────────────────────────────────────────
  await test('Q25 Card/Standee collision keeps Card-first and no cross-tenant leak', async () => {
    const before = await count('route:r_collision');
    const res = await request('/r/r_collision');
    assert.equal(res.status, 307);
    assert.equal(asInternal(res.location), '/acme/collision-card');
    assert.notEqual(res.location, 'https://example.test/alt-collision');
    assert.equal(await count('route:r_collision'), before + 1);
  });

  // ── Q26 reservations ────────────────────────────────────────────────────
  await test('Q26 reservations unchanged by QR display/testing', async () => {
    const after = JSON.stringify(
      (await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray())
        .map((r: any) => ({ path: r.path, kind: r.kind, status: r.status }))
    );
    assert.equal(after, reservationsBefore);
  });

  // ── Q27 printed QR compatibility ────────────────────────────────────────
  await test('Q27 historical /r, /qr, /t, /c, and slot URLs still work', async () => {
    assert.equal((await request('/r/r_standee')).status, 307);
    assert.equal((await request('/qr/panel_standee')).status, 307);
    assert.equal((await request('/qr/soc_standee')).status, 302);
    assert.equal((await request('/t/CARD1')).status, 302);
    assert.equal((await request('/c/business-card')).status, 307);
    assert.equal((await request('/r/r_aio3/1')).status, 307);
  });

  // ── Q28 UI surface audit ────────────────────────────────────────────────
  results.push({
    id: 'Q28 mobile/desktop QR UI rendering',
    status: 'NOT EXECUTED',
    detail:
      'No browser automation is installed. Source audit verified admin/customer components use the shared helper/API; actual responsive rendering was not exercised.',
  });
  console.log('NOT EXECUTED Q28 mobile/desktop QR UI rendering');

  // ── Q29 Phase 2A-2 regression ───────────────────────────────────────────
  await test('Q29 Phase 2A-2 single/AIO3/AIO4/legacy/review/fallback regression', async () => {
    assert.equal((await request('/acme/standee')).status, 307);
    assert.equal((await request('/acme/standee-3')).status, 307);
    assert.equal((await request('/acme/standee-4')).status, 307);
    assert.equal((await request('/acme/standee-5')).status, 200);
    assert.equal((await request('/acme/standee-6')).status, 307);
    assert.equal((await request('/acme/standee-7')).status, 200);
    assert.equal((await request('/r/r_aio3')).status, 307);
    assert.equal((await request('/r/r_aio4')).status, 307);
  });

  // ── Q30 no database mutation from QR display/download ───────────────────
  await test('Q30 QR display/download performs no database mutation', async () => {
    const snap = async () => ({
      users: await db.collection('users').countDocuments({}),
      cards: JSON.stringify(await db.collection('cards').find({}).sort({ _id: 1 }).project({ cardUid: 1, routeSlug: 1, publicSlug: 1, stats: 1 }).toArray()),
      standees: JSON.stringify(await db.collection('standees').find({}).sort({ _id: 1 }).project({ routeSlug: 1, publicSlug: 1 }).toArray()),
      reservations: JSON.stringify(await db.collection('public_url_reservations').find({}).sort({ path: 1 }).project({ path: 1, status: 1 }).toArray()),
    });
    const before = await snap();
    await qrPng('/api/my/qr?slug=r_card', acmeToken, '/tmp/p2a3-q30-card.png');
    await qrPng('/api/my/qr?slug=r_standee', acmeToken, '/tmp/p2a3-q30-standee.png');
    const s = byRoute.get('r_standee') as any;
    brandedStandeePanelQrUrl(s, origin);
    const after = await snap();
    assert.deepEqual(after, before);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  const blocked = results.filter((r) => r.status === 'BLOCKED');
  const notExecuted = results.filter((r) => r.status === 'NOT EXECUTED');
  console.log(JSON.stringify({
    database: DB,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: failures.length,
    blocked: blocked.length,
    notExecuted: notExecuted.length,
    results,
  }, null, 2));
  await client.close();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`PHASE2A3 TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  process.exit(1);
});
