/**
 * Phase 2A-3B matrix (B01–B32).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import {
  brandedStandeePanelQrUrl,
  permanentCardUrl,
  strictPermanentCardUrl,
} from '@/lib/admin-card-view';
import { resolveCanonicalPublicBase } from '@/lib/public-base';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A3B_JWT_SECRET ?? '';
const NO_ORIGIN_BASE = process.env.PHASE2A3B_NO_ORIGIN_BASE ?? '';
const PORT = 27035;
const BASE_PORT = 3207;
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT EXECUTED'; detail?: string }> = [];
let client: MongoClient;
let db: any;
let analytics: any;
let acme: any;
let acmeToken: string;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a3b_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== `http://127.0.0.1:${BASE_PORT}`) throw new Error('BLOCKED — wrong base URL');
  if (NO_ORIGIN_BASE !== 'http://127.0.0.1:3208') throw new Error('BLOCKED — wrong no-origin base');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
}

async function test(id: string, fn: () => Promise<void>, forced?: 'BLOCKED' | 'NOT EXECUTED', detail?: string) {
  if (forced) {
    results.push({ id, status: forced, detail });
    console.log(`${forced} ${id}`);
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

interface Resp { status: number; location: string | null; cacheControl: string | null; body: string }
function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const m = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3207(\/.*)?$/);
  return m ? (m[1] ?? '/') : location;
}
async function request(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Resp> {
  const headers = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: res.status, location: res.headers.get('location'), cacheControl: res.headers.get('cache-control'), body: await res.text() };
}
async function requestNoOrigin(path: string, cookie: string): Promise<Resp> {
  const res = await fetch(`${NO_ORIGIN_BASE}${path}`, { headers: { Cookie: `token=${cookie}` }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: res.status, location: res.headers.get('location'), cacheControl: res.headers.get('cache-control'), body: await res.text() };
}
async function qrPng(path: string, cookie: string, file: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: `token=${cookie}` }, redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /image\/png/);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
function decodeQr(file: string): string {
  const py = [
    'import cv2, sys',
    'img=cv2.imread(sys.argv[1])',
    'v,_,_=cv2.QRCodeDetector().detectAndDecode(img)',
    'print(v)',
  ].join('\n');
  return execFileSync('python3', ['-c', py, file], { encoding: 'utf8' }).trim();
}
const count = (metadata: string) => analytics.countDocuments({ metadata });
const countAction = (action: string, metadata: string) => analytics.countDocuments({ action, metadata });
const token = (userId: string, role = 'customer') => jwt.sign({ userId, role }, SECRET, { expiresIn: '1h' });
async function setFailpoint(mode: unknown, data: Record<string, unknown>) { await db.admin().command({ configureFailPoint: 'failCommand', mode, data }); }
async function clearFailpoint() { await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' }); }

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  analytics = db.collection('analyticslogs');
  acme = await db.collection('users').findOne({ bizSlug: 'acme' });
  assert.ok(acme);
  acmeToken = token(String(acme._id));
  const admin = await db.collection('users').findOne({ email: 'admin@test.local' });
  assert.ok(admin);
  const origin = 'http://127.0.0.1:3207';
  const profile = await db.collection('profiles').findOne({ userId: acme._id });
  const socialLinks = profile?.socialLinks ?? [];

  const cards = await db.collection('cards').find({}).toArray();
  const standees = await db.collection('standees').find({}).toArray();
  const byRoute = new Map(standees.map((s: any) => [s.routeSlug, s]));

  // Extra synthetic fixtures: same-origin loop and orphaned Card.
  const now = new Date();
  if (!byRoute.get('r_loop')) {
    const id = new ObjectId();
    await db.collection('standees').insertOne({
      _id: id, userId: acme._id, name: 'Loop Standee', displayName: 'Loop Standee',
      publicSlug: 'acme/standee-loop', routeSlug: 'r_loop', uid: 'u_loop',
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: 1, fixedProfiles: ['whatsapp'],
      panelQr: { qrId: 'panel_loop', qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: 'soc_loop', destinationUrl: `${origin}/acme/standee-loop`, qrColor: '#000000', label: 'whatsapp' }],
      createdAt: now, updatedAt: now,
    });
    await db.collection('public_url_reservations').insertOne({ path: 'acme/standee-loop', kind: 'standee', instanceId: id, ownerId: acme._id, status: 'active', source: 'backfill', issuedAt: now, retiredAt: null });
  }
  if (!cards.some((c: any) => c.publicSlug === 'orphan/card')) {
    await db.collection('cards').insertOne({
      _id: new ObjectId(), userId: new ObjectId(), assignedUserId: new ObjectId(),
      cardUid: 'CARD_ORPHAN', slug: 'orphan-card', urlAlias: 'orphan-card', routeSlug: 'r_orphancard',
      uid: 'u_orphancard', publicSlug: 'orphan/card', kind: 'profile', isActive: true, status: 'active',
      stats: { taps: 0 }, createdAt: now, updatedAt: now,
    });
  }
  const loop = await db.collection('standees').findOne({ routeSlug: 'r_loop' });
  assert.ok(loop);

  const reservationsBefore = JSON.stringify((await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray()).map((r: any) => ({ path: r.path, kind: r.kind, status: r.status })));

  // B01/B02/B06: Card QR analytics gate.
  await test('B01a existing NFC Card branded URL and printed /r', async () => {
    assert.equal((await request('/acme/business-card')).status, 200);
    const before = await count('route:r_card');
    const r = await request('/r/r_card');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/acme/business-card');
    assert.equal(await count('route:r_card'), before + 1);
  });
  await test('B02a new NFC Card branded URL and printed /r', async () => {
    assert.equal((await request('/acme/new-card')).status, 200);
    assert.equal((await request('/r/r_newcard')).status, 307);
  });
  results.push({ id: 'B01 software Card QR branded payload', status: 'BLOCKED', detail: 'Card QR remains /r because branded Card pages record 0 route taps and 0 Card taps. See B04.' });
  console.log('BLOCKED B01 software Card QR branded payload');
  results.push({ id: 'B02 new Card software QR branded payload', status: 'BLOCKED', detail: 'Same analytics gate as B01.' });
  console.log('BLOCKED B02 new Card software QR branded payload');

  await test('B03 Google Review Card branded/review behavior', async () => {
    assert.equal((await request('/acme/review-card')).status, 200);
    assert.equal((await request('/review/review-card')).status, 200);
    assert.equal((await request('/r/r_reviewcard')).status, 307);
  });

  await test('B04a Card branded vs /r analytics delta', async () => {
    const before = await count('route:r_card');
    const beforeCard = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal(await count('route:r_card'), before);
    const mid = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal(mid.stats.taps, beforeCard.stats.taps);
    assert.equal((await request('/r/r_card')).status, 307);
    assert.equal(await count('route:r_card'), before + 1);
    const after = await db.collection('cards').findOne({ routeSlug: 'r_card' });
    assert.equal(after.stats.taps, beforeCard.stats.taps + 1);
    results.push({ id: 'B04 Card QR switch decision', status: 'BLOCKED', detail: 'Branded Card = 0 taps; /r = +1. Switching Card QR would lose analytics.' });
  });

  await test('B05 ordinary branded Card visit is not counted as a tap', async () => {
    const before = await analytics.countDocuments({});
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal(await analytics.countDocuments({}), before);
  });

  results.push({ id: 'B06 Card preview/download/copy branded consistency', status: 'BLOCKED', detail: 'Card UI QR remains /r while /api/my/qr is branded; analytics gate applies.' });
  console.log('BLOCKED B06 Card preview/download/copy branded consistency');
  await test('B06b Card UI builders still resolve /r', async () => {
    const c = { routeSlug: 'r_card', uid: 'u_card', publicSlug: 'acme/business-card', urlAlias: 'business-card', slug: 'business-card' };
    assert.equal(permanentCardUrl(c, origin), `${origin}/r/r_card`);
    assert.equal(strictPermanentCardUrl(c, origin), `${origin}/r/r_card`);
  });

  // B07/B08 legacy AIO.
  results.push({ id: 'B07 legacy AIO branded panel QR', status: 'BLOCKED', detail: 'Legacy AIO branded entry keeps the picker; moving its panel QR to publicSlug would drop the existing /r route tap.' });
  console.log('BLOCKED B07 legacy AIO branded panel QR');
  await test('B07b legacy AIO picker/helper fallback and slots', async () => {
    const s = byRoute.get('r_legacy') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), `${origin}/r/r_legacy`);
    assert.equal((await request('/acme/standee-5')).status, 200);
    assert.equal((await request('/r/r_legacy')).status, 307);
    assert.equal((await request('/r/r_legacy/1')).status, 307);
  });

  // B09/B10 unconfigured, ambiguous, loop, collision.
  await test('B09 unconfigured Standee safe picker/fallback', async () => {
    const s = byRoute.get('r_unconfig') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin), `${origin}/r/r_unconfig`);
    assert.equal((await request('/acme/standee-7')).status, 200);
  });
  await test('B10 ambiguous/loop/collision safety', async () => {
    const amb = byRoute.get('r_ambiguous') as any;
    assert.equal(brandedStandeePanelQrUrl(amb, origin), `${origin}/r/r_ambiguous`);
    assert.equal(brandedStandeePanelQrUrl(loop, origin), `${origin}/r/r_loop`);
    assert.equal((await request('/acme/standee-9')).status, 200);
    assert.equal((await request('/acme/standee-loop')).status, 200);
    const collision = await request('/r/r_collision');
    assert.equal(collision.status, 307);
    assert.equal(asInternal(collision.location), '/acme/collision-card');
  });

  // B11 Profile.socialLinks enrichment.
  await test('B11 Profile.socialLinks single Standee becomes eligible', async () => {
    const s = byRoute.get('r_profilesocial') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin, []), `${origin}/r/r_profilesocial`);
    assert.equal(brandedStandeePanelQrUrl(s, origin, socialLinks), `${origin}/acme/standee-8`);
    const branded = await request('/acme/standee-8');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_profilesocial');
    const r = await request('/r/r_profilesocial');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/profile-whatsapp');
  });

  // B12/B13 AIO.
  await test('B12 AIO3 branded panel and slots', async () => {
    const s = byRoute.get('r_aio3') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin, socialLinks), `${origin}/acme/standee-3`);
    assert.equal((await request('/r/r_aio3/1')).location, 'https://example.test/aio3-google');
    assert.equal((await request('/r/r_aio3/3')).location, 'https://example.test/aio3-facebook');
  });
  await test('B13 AIO4 branded panel and slots', async () => {
    const s = byRoute.get('r_aio4') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin, socialLinks), `${origin}/acme/standee-4`);
    assert.equal((await request('/r/r_aio4/4')).location, 'https://example.test/aio4-facebook');
  });

  // B14 review.
  await test('B14 Google Review Standee review-page view', async () => {
    const s = byRoute.get('r_reviewstandee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin, socialLinks), `${origin}/acme/standee-6`);
    const beforeRoute = await count('route:r_reviewstandee');
    const beforeView = await countAction('review_page_view', 'standee-review:r_reviewstandee');
    assert.equal((await request('/acme/standee-6')).status, 307);
    const r = await request('/r/r_reviewstandee');
    assert.equal(asInternal(r.location), '/standee-review/r_reviewstandee');
    assert.equal(await count('route:r_reviewstandee'), beforeRoute + 1);
    assert.equal((await request('/standee-review/r_reviewstandee')).status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_reviewstandee'), beforeView + 1);
  });

  // B15 printed QR.
  await test('B15 historical printed QR routes', async () => {
    for (const path of ['/r/r_standee', '/r/r_standee/1', '/qr/panel_standee', '/qr/soc_standee', '/t/CARD1', '/c/business-card']) {
      const res = await request(path);
      assert.ok([200, 302, 307].includes(res.status), `${path} ${res.status}`);
    }
  });

  // B16/B17 suspension/reactivation.
  await test('B16 suspended owner blocks all public entry points with zero analytics', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'suspended' } });
    const before = await analytics.countDocuments({});
    for (const path of ['/acme/business-card', '/acme/standee', '/acme/standee-3', '/acme/standee-8']) assert.equal((await request(path)).status, 404, path);
    assert.equal((await request('/r/r_card')).status, 404);
    assert.equal((await request('/r/r_standee')).status, 404);
    assert.equal((await request('/qr/panel_standee')).status, 404);
    assert.equal(await analytics.countDocuments({}), before);
  });
  await test('B17 reactivated owner restores same URLs/identifiers', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'active' } });
    const before = await db.collection('standees').findOne({ routeSlug: 'r_standee' });
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal((await request('/acme/standee')).status, 307);
    const after = await db.collection('standees').findOne({ routeSlug: 'r_standee' });
    assert.equal(after.publicSlug, before.publicSlug);
    assert.equal(after.routeSlug, before.routeSlug);
  });

  // B18/B19 missing owner and lookup failure.
  await test('B18 missing owner fails closed for Standee and Card', async () => {
    const before = await analytics.countDocuments({});
    for (const path of ['/orphan/standee', '/r/r_orphanstandee', '/panel/r_orphanstandee', '/orphan/card', '/r/r_orphancard']) {
      assert.equal((await request(path)).status, 404, path);
    }
    assert.equal(await analytics.countDocuments({}), before);
  });
  await test('B19 owner lookup failure fails closed', async () => {
    for (const path of ['/acme/business-card', '/acme/standee', '/r/r_card']) {
      const before = await analytics.countDocuments({});
      try {
        await setFailpoint({ times: 1 }, { failCommands: ['find'], namespace: `${DB}.users`, errorCode: 2 });
        const res = await request(path);
        assert.equal(res.status, 404, `${path} ${res.status}`);
        assert.equal(await analytics.countDocuments({}), before);
      } finally {
        await clearFailpoint();
      }
    }
  });

  // B20 tenant isolation.
  await test('B20 tenant isolation through public and API routes', async () => {
    const own = await request('/api/standees', { cookie: `token=${acmeToken}` });
    assert.equal(own.status, 200);
    for (const s of JSON.parse(own.body).standees) assert.equal(String(s.userId), String(acme._id));
    const collision = await request('/r/r_collision');
    assert.equal(asInternal(collision.location), '/acme/collision-card');
    assert.notEqual(collision.location, 'https://example.test/alt-collision');
  });

  // B21 collision.
  await test('B21 Card-first collision safety', async () => {
    const res = await request('/r/r_collision');
    assert.equal(res.status, 307);
    assert.equal(asInternal(res.location), '/acme/collision-card');
  });

  // B22 analytics exactness.
  await test('B22 route, Card, slot, and review events remain separate', async () => {
    const beforeRoute = await count('route:r_standee');
    const beforeSlot = await count('route:r_aio3/slot:1/platform:google_review');
    await request('/r/r_standee');
    await request('/r/r_aio3/1');
    assert.equal(await count('route:r_standee'), beforeRoute + 1);
    assert.equal(await count('route:r_aio3/slot:1/platform:google_review'), beforeSlot + 1);
  });

  // B23 analytics write failure.
  await test('B23 analytics insert failure is fail-open and not duplicated', async () => {
    const before = await count('route:r_standee');
    try {
      await setFailpoint({ times: 1 }, { failCommands: ['insert'], namespace: `${DB}.analyticslogs`, errorCode: 2 });
      const res = await request('/r/r_standee');
      assert.equal(res.status, 307);
      assert.equal(res.location, 'https://example.test/standee');
      assert.equal(await count('route:r_standee'), before);
    } finally {
      await clearFailpoint();
    }
    assert.equal((await request('/r/r_standee')).status, 307);
    assert.equal(await count('route:r_standee'), before + 1);
  });

  // B24/B25 origin.
  await test('B24 missing canonical origin makes QR unavailable', async () => {
    assert.equal((await requestNoOrigin('/api/my/qr?slug=r_standee', acmeToken)).status, 409);
    assert.equal(brandedStandeePanelQrUrl(byRoute.get('r_standee') as any, ''), '');
  });
  await test('B25 invalid canonical origins rejected', async () => {
    for (const configured of ['javascript:alert(1)', 'https://user:pass@example.test', 'https://example.test/path?x=1']) {
      assert.equal(resolveCanonicalPublicBase({ configured, nodeEnv: 'development' }), '');
    }
    assert.equal(brandedStandeePanelQrUrl(byRoute.get('r_standee') as any, 'javascript:alert(1)'), '');
  });

  // B26 QR decode.
  await test('B26 decoded QR images match expected payloads', async () => {
    await qrPng('/api/my/qr?slug=r_card', acmeToken, '/tmp/p2a3b-card.png');
    await qrPng('/api/my/qr?slug=r_standee', acmeToken, '/tmp/p2a3b-standee.png');
    const panelUrl = brandedStandeePanelQrUrl(byRoute.get('r_standee') as any, origin, socialLinks);
    writeFileSync('/tmp/p2a3b-panel.png', await QRCode.toBuffer(panelUrl, { width: 320, margin: 2 }));
    assert.equal(decodeQr('/tmp/p2a3b-card.png'), `${origin}/acme/business-card`);
    assert.equal(decodeQr('/tmp/p2a3b-standee.png'), `${origin}/acme/standee`);
    assert.equal(decodeQr('/tmp/p2a3b-panel.png'), `${origin}/acme/standee`);
  });

  // B27 admin/customer consistency.
  results.push({ id: 'B27 Card admin/customer QR consistency', status: 'BLOCKED', detail: 'Card UI QR remains /r while /api/my/qr is branded; analytics gate applies.' });
  console.log('BLOCKED B27 Card admin/customer QR consistency');
  await test('B27b Standee admin/customer consistency', async () => {
    const s = byRoute.get('r_standee') as any;
    assert.equal(brandedStandeePanelQrUrl(s, origin, socialLinks), `${origin}/${s.publicSlug}`);
  });

  // B28 reservations.
  await test('B28 reservations unchanged', async () => {
    const after = JSON.stringify((await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray()).map((r: any) => ({ path: r.path, kind: r.kind, status: r.status })));
    assert.equal(after, reservationsBefore);
  });

  // B29/B30 regression.
  await test('B29 Phase 2A-2 regression', async () => {
    assert.equal((await request('/acme/standee')).status, 307);
    assert.equal((await request('/acme/standee-3')).status, 307);
    assert.equal((await request('/acme/standee-4')).status, 307);
    assert.equal((await request('/acme/standee-5')).status, 200);
    assert.equal((await request('/acme/standee-6')).status, 307);
  });
  await test('B30 Phase 2A-3 Standee panel QR regression', async () => {
    assert.equal(brandedStandeePanelQrUrl(byRoute.get('r_standee') as any, origin, socialLinks), `${origin}/acme/standee`);
    assert.equal(brandedStandeePanelQrUrl(byRoute.get('r_aio3') as any, origin, socialLinks), `${origin}/acme/standee-3`);
    assert.equal(brandedStandeePanelQrUrl(byRoute.get('r_aio4') as any, origin, socialLinks), `${origin}/acme/standee-4`);
  });

  // B31 browser.
  results.push({ id: 'B31 desktop/mobile browser verification', status: 'NOT EXECUTED', detail: 'No browser automation installed; source/pure-helper and QR-image checks executed instead.' });
  console.log('NOT EXECUTED B31 desktop/mobile browser verification');

  // B32 attribution.
  await test('B32 identical branded requests cannot be attributed to QR vs ordinary visit', async () => {
    const before = await count('route:r_card');
    const first = await request('/acme/business-card');
    const second = await request('/acme/business-card');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(await count('route:r_card'), before);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({
    database: DB,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: failures.length,
    blocked: results.filter((r) => r.status === 'BLOCKED').length,
    notExecuted: results.filter((r) => r.status === 'NOT EXECUTED').length,
    results,
  }, null, 2));
  await client.close();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`PHASE2A3B TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  process.exit(1);
});
