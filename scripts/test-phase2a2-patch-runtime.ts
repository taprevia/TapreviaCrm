/**
 * Phase 2A-2 security-patch runtime matrix (S01–S22, S24).
 *
 * Fresh isolated DB/runtime only. Manual redirects, bounded failpoints, exact
 * analytics deltas, and owner status toggling for reactivation coverage.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A2_JWT_SECRET ?? '';
const PORT = 27033;
const BASE_PORT = 3203;
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; detail?: string }> = [];
let client: MongoClient;
let db: any;
let analytics: any;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_patch_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== `http://127.0.0.1:${BASE_PORT}`) throw new Error('BLOCKED — wrong base URL');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
}

async function test(id: string, fn: () => Promise<void>) {
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
  const match = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3203(\/.*)?$/);
  if (match) return match[1] ?? '/';
  return location;
}

async function request(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Resp> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers,
    redirect: 'manual',
    body: init.body,
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
    body: await res.text(),
  };
}

function rawRequest(path: string, init: { cookie?: string } = {}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: BASE_PORT, path, method: 'GET', headers: init.cookie ? { Cookie: init.cookie } : {}, timeout: 30000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          location: (res.headers.location as string | undefined) ?? null,
          cacheControl: (res.headers['cache-control'] as string | undefined) ?? null,
          body,
        }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const count = (metadata: string) => analytics.countDocuments({ metadata });
const countAction = (action: string, metadata: string) => analytics.countDocuments({ action, metadata });
const token = (userId: string, role = 'customer', opts: { expired?: boolean } = {}) =>
  jwt.sign({ userId, role }, SECRET, { expiresIn: opts.expired ? '-1s' : '1h' });

async function setFailpoint(mode: unknown, data: Record<string, unknown>): Promise<void> {
  await db.admin().command({ configureFailPoint: 'failCommand', mode, data });
}
async function clearFailpoint(): Promise<void> {
  await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
}

async function user(key: string): Promise<any> {
  const slugMap: Record<string, string> = {
    activecard: 'patchactive', suspcard: 'patchsusp', standee: 'patchstandee', aio3: 'patchaio3',
    aio4: 'patchaio4', legacy: 'patchlegacy', review: 'patchreview', admin: 'patchadmin',
  };
  const doc = await db.collection('users').findOne({ bizSlug: slugMap[key] });
  assert.ok(doc, `missing user ${key}`);
  return doc;
}
const setStatus = (userId: unknown, status: 'active' | 'suspended') =>
  db.collection('users').updateOne({ _id: userId }, { $set: { status } });

async function setupExtraFixtures(): Promise<void> {
  const now = new Date();
  const activecard = await user('activecard');
  const standeeOwner = await user('standee');

  const nfc = await db.collection('catalogproducts').findOne({ slug: 'business-nfc-card' });
  let nfcId = nfc?._id;
  if (!nfc) {
    nfcId = new ObjectId();
    await db.collection('catalogproducts').insertOne({
      _id: nfcId, name: 'Business NFC Card', slug: 'business-nfc-card', kind: 'profile',
      category: 'nfc_card', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now,
    });
  }
  const hasNfc = await db.collection('userproducts').findOne({ userId: activecard._id, catalogProductId: nfcId });
  if (!hasNfc) {
    await db.collection('userproducts').insertOne({
      _id: new ObjectId(), userId: activecard._id, catalogProductId: nfcId, standeeId: null,
      status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now,
    });
  }

  const orphanCard = await db.collection('cards').findOne({ publicSlug: 'patchorphan/card' });
  if (!orphanCard) {
    await db.collection('cards').insertOne({
      _id: new ObjectId(), userId: new ObjectId(), assignedUserId: new ObjectId(),
      cardUid: 'CARD_PORPHANCARD', slug: 'porphancard', urlAlias: 'porphancard',
      routeSlug: 'r_porphancard', uid: 'u_porphancard', publicSlug: 'patchorphan/card',
      kind: 'profile', isActive: true, status: 'active', stats: { taps: 0 },
      createdAt: now, updatedAt: now,
    });
  }

  for (const spec of [
    {
      publicSlug: 'patchloop/standee', routeSlug: 'r_ploop', uid: 'u_ploop',
      destinationUrl: 'http://127.0.0.1:3203/patchloop/standee', panelQr: 'panel_ploop', qrId: 'soc_ploop',
    },
    {
      publicSlug: 'patchunsafe/standee', routeSlug: 'r_punsafe', uid: 'u_punsafe',
      destinationUrl: 'javascript:alert(1)', panelQr: 'panel_punsafe', qrId: 'soc_punsafe',
    },
  ]) {
    const exists = await db.collection('standees').findOne({ publicSlug: spec.publicSlug });
    if (exists) continue;
    const id = new ObjectId();
    await db.collection('standees').insertOne({
      _id: id, userId: standeeOwner._id, name: spec.publicSlug, displayName: spec.publicSlug,
      publicSlug: spec.publicSlug, routeSlug: spec.routeSlug, uid: spec.uid,
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: 1, fixedProfiles: ['whatsapp'],
      panelQr: { qrId: spec.panelQr, qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: spec.qrId, destinationUrl: spec.destinationUrl, qrColor: '#000000', label: 'whatsapp' }],
      createdAt: now, updatedAt: now,
    });
    await db.collection('public_url_reservations').insertOne({
      path: spec.publicSlug, kind: 'standee', instanceId: id, ownerId: standeeOwner._id,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    });
  }
}

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  const names = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(names.includes(DB), 'test database missing');
  analytics = db.collection('analyticslogs');
  await setupExtraFixtures();

  const activecard = await user('activecard');
  const suspcard = await user('suspcard');
  const standeeOwner = await user('standee');
  const aio3 = await user('aio3');
  const aio4 = await user('aio4');
  const legacy = await user('legacy');
  const review = await user('review');
  const admin = await user('admin');

  const reservationsBefore = JSON.stringify(
    (await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray())
      .map((r: any) => ({ path: r.path, kind: r.kind, status: r.status }))
  );

  // ── S01 active Card ──────────────────────────────────────────────────────
  await test('S01 active Card: branded, /r, /qr, /t, /c, profile, review', async () => {
    assert.equal((await request('/patchsusp/profile-card')).status, 200);
    const beforeRoute = await count('route:r_sc_profile');
    const r = await request('/r/r_sc_profile');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/patchsusp/profile-card');
    assert.equal(await count('route:r_sc_profile'), beforeRoute + 1);

    const qr = await request('/qr/r_sc_profile');
    assert.equal(qr.status, 302);
    assert.equal(asInternal(qr.location), '/profile/sc-profile');

    const beforeTap = await countAction('tap', 'card:CARD_SC_PROFILE');
    const t = await request('/t/CARD_SC_PROFILE');
    assert.equal(t.status, 302);
    assert.equal(asInternal(t.location), '/profile/sc-profile?src=nfc');
    assert.equal(await countAction('tap', 'card:CARD_SC_PROFILE'), beforeTap + 1);

    const beforeC = await countAction('tap', 'card:sc-profile');
    const c = await request('/c/sc-profile');
    assert.equal(c.status, 307);
    assert.equal(asInternal(c.location), '/profile/sc-profile');
    assert.equal(await countAction('tap', 'card:sc-profile'), beforeC + 1);

    assert.equal((await request('/profile/sc-profile')).status, 200);
    assert.equal((await request('/review/sc-profile')).status, 200);

    const social = await request('/patchsusp/social-card');
    assert.equal(social.status, 307);
    assert.equal(social.location, 'https://example.test/sc-social');
  });

  // ── S02 suspended Card ───────────────────────────────────────────────────
  await test('S02 suspended Card: all public routes blocked, zero analytics', async () => {
    await setStatus(suspcard._id, 'suspended');
    const before = await analytics.countDocuments({});
    const tapsBefore = (await db.collection('cards').findOne({ routeSlug: 'r_sc_profile' })).stats.taps;

    assert.equal((await request('/patchsusp/profile-card')).status, 404);
    assert.equal((await request('/patchsusp/social-card')).status, 404);
    assert.equal((await request('/r/r_sc_profile')).status, 404);
    assert.equal((await request('/r/r_sc_social')).status, 404);
    assert.equal((await request('/qr/r_sc_profile')).status, 404);
    assert.equal((await request('/qr/r_sc_social')).status, 404);
    assert.equal((await request('/c/sc-profile')).status, 404);
    assert.equal((await request('/c/CARD_SC_PROFILE')).status, 404);
    assert.equal((await request('/profile/sc-profile')).status, 404);
    const reviewPage = await request('/review/sc-profile');
    assert.equal(reviewPage.status, 200);
    assert.match(reviewPage.body, /Review not available|Reviews aren/);

    const t = await request('/t/CARD_SC_PROFILE');
    assert.equal(t.status, 302);
    assert.equal(asInternal(t.location), '/');
    assert.equal((await request('/t/r_sc_profile')).status, 302);

    const track = await request('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'sc-profile', action: 'tap' }),
    });
    assert.equal(track.status, 200);
    assert.match(track.body, /skipped/);

    assert.equal(await analytics.countDocuments({}), before);
    const tapsAfter = (await db.collection('cards').findOne({ routeSlug: 'r_sc_profile' })).stats.taps;
    assert.equal(tapsAfter, tapsBefore);
  });

  // ── S03 reactivated Card ─────────────────────────────────────────────────
  await test('S03 reactivated Card: original identifiers and analytics resume', async () => {
    await setStatus(suspcard._id, 'active');
    const before = await count('route:r_sc_profile');
    assert.equal((await request('/patchsusp/profile-card')).status, 200);
    const r = await request('/r/r_sc_profile');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/patchsusp/profile-card');
    assert.equal(await count('route:r_sc_profile'), before + 1);
    const qr = await request('/qr/r_sc_profile');
    assert.equal(qr.status, 302);
    assert.equal(asInternal(qr.location), '/profile/sc-profile');
    const t = await request('/t/CARD_SC_PROFILE');
    assert.equal(t.status, 302);
    assert.equal(asInternal(t.location), '/profile/sc-profile?src=nfc');
    const c = await request('/c/sc-profile');
    assert.equal(c.status, 307);
    assert.equal(asInternal(c.location), '/profile/sc-profile');
  });

  // ── S04–S06 standard Standee ─────────────────────────────────────────────
  await test('S04 active standard Standee: branded, /r, /qr, /panel, slot', async () => {
    assert.equal((await request('/patchstandee/standee')).status, 307);
    const before = await count('route:r_ps_single');
    const r = await request('/r/r_ps_single');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/ps-single');
    assert.equal(await count('route:r_ps_single'), before + 1);

    const beforeSlot = await count('route:r_ps_single/slot:1/platform:whatsapp');
    const slot = await request('/r/r_ps_single/1');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/ps-single');
    assert.equal(await count('route:r_ps_single/slot:1/platform:whatsapp'), beforeSlot + 1);

    const beforePanelQr = await count('qr-panel:panel_ps_single');
    const panelQr = await request('/qr/panel_ps_single');
    assert.equal(panelQr.status, 307);
    assert.equal(asInternal(panelQr.location), '/panel/r_ps_single');
    assert.equal(await count('qr-panel:panel_ps_single'), beforePanelQr + 1);

    assert.equal((await request('/qr/soc_ps_single')).status, 302);
    assert.equal((await request('/panel/r_ps_single')).status, 200);
  });

  await test('S05 suspended standard Standee: all entry points blocked, zero events', async () => {
    await setStatus(standeeOwner._id, 'suspended');
    const before = await analytics.countDocuments({});
    assert.equal((await request('/patchstandee/standee')).status, 404);
    assert.equal((await request('/r/r_ps_single')).status, 404);
    assert.equal((await request('/r/r_ps_single/1')).status, 404);
    assert.equal((await request('/qr/panel_ps_single')).status, 404);
    assert.equal((await request('/qr/soc_ps_single')).status, 404);
    assert.equal((await request('/panel/r_ps_single')).status, 404);
    const track = await request('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'r_ps_single', action: 'tap' }),
    });
    assert.equal(track.status, 200);
    assert.match(track.body, /skipped/);
    assert.equal((await analytics.countDocuments({})), before);
  });

  await test('S06 reactivated standard Standee: identifiers and analytics resume', async () => {
    await setStatus(standeeOwner._id, 'active');
    const before = await count('route:r_ps_single');
    assert.equal((await request('/patchstandee/standee')).status, 307);
    const r = await request('/r/r_ps_single');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/ps-single');
    assert.equal(await count('route:r_ps_single'), before + 1);
    assert.equal((await request('/qr/panel_ps_single')).status, 307);
    const track = await request('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'r_ps_single', action: 'tap' }),
    });
    assert.equal(track.status, 202);
  });

  // ── S07–S09 AIO3 ─────────────────────────────────────────────────────────
  await test('S07 active AIO3: picker, route tap, slot tap, ordering', async () => {
    const beforeRoute = await count('route:r_pa3');
    const beforeSlot = await count('route:r_pa3/slot:1/platform:google_review');
    const branded = await request('/patchaio3/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_pa3');
    const r = await request('/r/r_pa3');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_pa3');
    assert.equal(await count('route:r_pa3'), beforeRoute + 1);
    const panel = await request('/panel/r_pa3');
    assert.equal(panel.status, 200);
    const gi = panel.body.indexOf('Google Review');
    const ii = panel.body.indexOf('Instagram');
    const fi = panel.body.indexOf('Facebook');
    assert.ok(gi >= 0 && gi < ii && ii < fi, 'AIO3 slot order');
    const slot = await request('/r/r_pa3/1');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/pa3-google');
    assert.equal(await count('route:r_pa3/slot:1/platform:google_review'), beforeSlot + 1);
    assert.equal((await request('/qr/soc_pa3_1')).status, 302);
    assert.equal((await request('/qr/panel_pa3')).status, 307);
  });

  await test('S08 suspended AIO3: every public entry point blocked', async () => {
    await setStatus(aio3._id, 'suspended');
    const before = await analytics.countDocuments({});
    assert.equal((await request('/patchaio3/standee')).status, 404);
    assert.equal((await request('/r/r_pa3')).status, 404);
    assert.equal((await request('/r/r_pa3/1')).status, 404);
    assert.equal((await request('/panel/r_pa3')).status, 404);
    assert.equal((await request('/qr/panel_pa3')).status, 404);
    assert.equal((await request('/qr/soc_pa3_1')).status, 404);
    assert.equal(await analytics.countDocuments({}), before);
  });

  await test('S09 reactivated AIO3: picker and identifiers restored', async () => {
    await setStatus(aio3._id, 'active');
    assert.equal((await request('/patchaio3/standee')).status, 307);
    assert.equal((await request('/r/r_pa3')).status, 307);
    assert.equal((await request('/panel/r_pa3')).status, 200);
    assert.equal((await request('/r/r_pa3/1')).status, 307);
  });

  // ── S10–S12 AIO4 ─────────────────────────────────────────────────────────
  await test('S10 active AIO4: routing and picker', async () => {
    assert.equal((await request('/patchaio4/standee')).status, 307);
    const r = await request('/r/r_pa4');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_pa4');
    assert.equal((await request('/panel/r_pa4')).status, 200);
    assert.equal((await request('/r/r_pa4/4')).status, 307);
  });

  await test('S11 suspended AIO4: every entry point blocked', async () => {
    await setStatus(aio4._id, 'suspended');
    const before = await analytics.countDocuments({});
    for (const path of ['/patchaio4/standee', '/r/r_pa4', '/r/r_pa4/1', '/panel/r_pa4', '/qr/panel_pa4', '/qr/soc_pa4_1']) {
      assert.equal((await request(path)).status, 404, `${path}`);
    }
    assert.equal(await analytics.countDocuments({}), before);
  });

  await test('S12 reactivated AIO4: routing restored', async () => {
    await setStatus(aio4._id, 'active');
    assert.equal((await request('/patchaio4/standee')).status, 307);
    assert.equal((await request('/r/r_pa4')).status, 307);
    assert.equal((await request('/panel/r_pa4')).status, 200);
  });

  // ── S13 legacy AIO ───────────────────────────────────────────────────────
  await test('S13 legacy AIO active/suspended/reactivated', async () => {
    assert.equal((await request('/patchlegacy/standee')).status, 200);
    assert.equal((await request('/r/r_pl')).status, 307);
    assert.equal((await request('/r/r_pl/1')).status, 307);

    await setStatus(legacy._id, 'suspended');
    const before = await analytics.countDocuments({});
    for (const path of ['/patchlegacy/standee', '/r/r_pl', '/r/r_pl/1', '/panel/r_pl', '/qr/panel_pl', '/qr/soc_pl_1']) {
      assert.equal((await request(path)).status, 404, `${path}`);
    }
    assert.equal(await analytics.countDocuments({}), before);

    await setStatus(legacy._id, 'active');
    assert.equal((await request('/patchlegacy/standee')).status, 200);
    assert.equal((await request('/r/r_pl')).status, 307);
    assert.equal((await request('/r/r_pl/1')).status, 307);
  });

  // ── S14 Google Review Standee + review Card ──────────────────────────────
  await test('S14 review host active/suspended/reactivated and review Card', async () => {
    const beforeRoute = await count('route:r_pr');
    const beforeView = await countAction('review_page_view', 'standee-review:r_pr');
    assert.equal((await request('/patchreview/standee')).status, 307);
    const r = await request('/r/r_pr');
    assert.equal(asInternal(r.location), '/standee-review/r_pr');
    assert.equal(await count('route:r_pr'), beforeRoute + 1);
    assert.equal((await request('/standee-review/r_pr')).status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_pr'), beforeView + 1);
    assert.equal((await request('/patchreview/review-card')).status, 200);
    assert.equal((await request('/r/r_pr_card')).status, 307);

    await setStatus(review._id, 'suspended');
    const before = await analytics.countDocuments({});
    for (const path of ['/patchreview/standee', '/r/r_pr', '/qr/panel_pr', '/qr/soc_pr', '/panel/r_pr', '/patchreview/review-card', '/r/r_pr_card']) {
      assert.equal((await request(path)).status, 404, `${path}`);
    }
    const unavailable = await request('/standee-review/r_pr');
    assert.equal(unavailable.status, 200);
    assert.match(unavailable.body, /Review not available|Reviews aren/);
    const reviewUnavailable = await request('/review/pr-review');
    assert.equal(reviewUnavailable.status, 200);
    assert.equal(await analytics.countDocuments({}), before);

    await setStatus(review._id, 'active');
    assert.equal((await request('/patchreview/standee')).status, 307);
    assert.equal((await request('/r/r_pr')).status, 307);
    assert.equal((await request('/standee-review/r_pr')).status, 200);
    assert.equal((await request('/patchreview/review-card')).status, 200);
  });

  // ── S15 owner lookup failure ─────────────────────────────────────────────
  await test('S15 owner lookup failure fails closed for Card and Standee', async () => {
    for (const path of ['/patchactive/profile-card', '/patchstandee/standee', '/r/r_pc_profile']) {
      const before = await analytics.countDocuments({});
      try {
        await setFailpoint({ times: 1 }, {
          failCommands: ['find'],
          namespace: `${DB}.users`,
          errorCode: 2,
        });
        const res = await request(path);
        assert.equal(res.status, 404, `${path} status ${res.status}`);
        assert.equal(res.location, null);
        assert.equal(await analytics.countDocuments({}), before, `${path} wrote analytics`);
      } finally {
        await clearFailpoint();
      }
    }
  });

  // ── S16 orphan Standee ───────────────────────────────────────────────────
  await test('S16 orphaned Standee is inaccessible and writes nothing', async () => {
    const before = await analytics.countDocuments({});
    for (const path of [
      '/patchorphan/standee', '/r/r_porphan', '/panel/r_porphan', '/qr/panel_porphan',
      '/patchorphan/card', '/r/r_porphancard', '/c/porphancard', '/qr/r_porphancard',
    ]) {
      assert.equal((await request(path)).status, 404, `${path}`);
    }
    assert.equal(await analytics.countDocuments({}), before);
  });

  // ── S17/S18 collision and cross-tenant ───────────────────────────────────
  await test('S17 active Card wins Card/Standee collision', async () => {
    const before = await count('route:r_collision');
    const res = await request('/r/r_collision');
    assert.equal(res.status, 307);
    assert.equal(asInternal(res.location), '/patchactive/collision-card');
    assert.notEqual(res.location, 'https://example.test/standee-collision');
    assert.equal(await count('route:r_collision'), before + 1);
  });

  await test('S18 suspended Card collision never reveals the Standee', async () => {
    await setStatus(activecard._id, 'suspended');
    const before = await analytics.countDocuments({});
    const res = await request('/r/r_collision');
    assert.equal(res.status, 404);
    assert.equal(res.location, null);
    const standeeBranded = await request('/patchstandee/collision');
    // Standee owner is active, but its route key is Card-first and the Card
    // owner is suspended; the branded preflight keeps the picker.
    assert.equal(standeeBranded.status, 200);
    const standeeRoute = await request('/r/r_collision');
    assert.equal(standeeRoute.status, 404);
    assert.equal(await analytics.countDocuments({}), before);
    await setStatus(activecard._id, 'active');
    const restored = await request('/r/r_collision');
    assert.equal(restored.status, 307);
    assert.equal(asInternal(restored.location), '/patchactive/collision-card');
  });

  // ── S19 analytics history and exactness ──────────────────────────────────
  await test('S19 historical analytics unchanged; no duplicate route taps', async () => {
    const doc = await analytics.findOne({ metadata: 'historical:patch' });
    assert.ok(doc);
    assert.equal(doc.action, 'tap');
    const before = await count('route:r_ps_single');
    await request('/r/r_ps_single');
    assert.equal(await count('route:r_ps_single'), before + 1);
    await request('/patchstandee/standee');
    assert.equal(await count('route:r_ps_single'), before + 1);
  });

  // ── S20 reservation stability ────────────────────────────────────────────
  await test('S20 reservations unchanged through suspension/reactivation', async () => {
    const after = JSON.stringify(
      (await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray())
        .map((r: any) => ({ path: r.path, kind: r.kind, status: r.status }))
    );
    assert.equal(after, reservationsBefore);
  });

  // ── S21 authentication ───────────────────────────────────────────────────
  await test('S21 authentication and tenant isolation unchanged', async () => {
    const publicStandee = await request('/patchstandee/standee');
    assert.equal(publicStandee.status, 307);
    for (const cookie of ['token=bad', `token=${token(String(standeeOwner._id), 'customer', { expired: true })}`, 'token=%%%bad%%%']) {
      const res = await request('/patchstandee/standee', { cookie });
      assert.equal(res.status, 307);
      assert.equal(res.location, '/r/r_ps_single');
    }

    for (const cookie of ['token=bad', 'token=%%%bad%%%']) {
      const admin = await request('/admin', { cookie });
      assert.equal(admin.status, 307);
      assert.match(asInternal(admin.location) ?? '', /^\/login/);
    }
    const customerAdmin = await request('/admin', { cookie: `token=${token(String(standeeOwner._id), 'customer')}` });
    assert.equal(customerAdmin.status, 307);
    assert.equal(asInternal(customerAdmin.location), '/dashboard');
    const realAdmin = await request('/admin', { cookie: `token=${token(String(admin._id), 'admin')}` });
    assert.ok(!(realAdmin.status === 307 && asInternal(realAdmin.location) === '/login'));

    const own = await request('/api/standees', { cookie: `token=${token(String(standeeOwner._id))}` });
    assert.equal(own.status, 200);
    const body = JSON.parse(own.body);
    for (const s of body.standees) assert.equal(String(s.userId), String(standeeOwner._id));
  });

  // ── S22 malformed paths and loops ────────────────────────────────────────
  await test('S22 malformed paths, loops, and unsafe destinations stay safe', async () => {
    const loop = await request('/patchloop/standee');
    assert.equal(loop.status, 200);
    const loopRoute = await request('/r/r_ploop');
    assert.ok([307, 404].includes(loopRoute.status), `loop route ${loopRoute.status}`);
    if (loopRoute.status === 307) {
      assert.equal(asInternal(loopRoute.location), '/patchloop/standee');
    }

    const unsafe = await request('/patchunsafe/standee');
    assert.equal(unsafe.status, 200);
    assert.equal((await request('/r/r_punsafe')).status, 404);

    for (const path of [
      '/patchactive%2Fprofile-card',
      '/patchactive/profile-card%2F..%2Fadmin',
      '/r/r_ps_single%2F..%2Fr_pa3',
      '/r/r_ps_single%252F..%252Fr_pa3',
    ]) {
      const before = await analytics.countDocuments({});
      const res = await rawRequest(path);
      assert.ok(res.status < 500, `${path} status ${res.status}`);
      const loc = asInternal(res.location) ?? '';
      assert.ok(!/^javascript:|^data:|^\/\//i.test(loc), `${path} unsafe location`);
      if (res.status >= 400) assert.equal(await analytics.countDocuments({}), before, `${path} wrote analytics`);
    }
    const malformed = await rawRequest('/patchactive/%E0%A4%A');
    assert.ok(malformed.status < 500);
    const bypass = await rawRequest('/admin%252Fstandee', { cookie: 'token=bad' });
    assert.ok(bypass.status < 500);
  });

  // ── S24 Phase 2A-2 regression ────────────────────────────────────────────
  await test('S24 single/AIO3/AIO4/review delegation, 307 and no-store', async () => {
    const single = await request('/patchstandee/standee');
    assert.equal(single.status, 307);
    assert.equal(single.location, '/r/r_ps_single');
    assert.match(single.cacheControl ?? '', /no-store/);
    assert.notEqual(single.status, 301);
    assert.notEqual(single.status, 308);

    const aio3 = await request('/patchaio3/standee');
    assert.equal(aio3.status, 307);
    assert.equal(aio3.location, '/r/r_pa3');
    const aio4 = await request('/patchaio4/standee');
    assert.equal(aio4.status, 307);
    assert.equal(aio4.location, '/r/r_pa4');
    const legacy = await request('/patchlegacy/standee');
    assert.equal(legacy.status, 200);
    const review = await request('/patchreview/standee');
    assert.equal(review.status, 307);
    assert.equal(review.location, '/r/r_pr');

    const head = await request('/patchstandee/standee', { method: 'HEAD' });
    assert.equal(head.status, 307);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  const blocked = results.filter((r) => r.status === 'BLOCKED');
  console.log(JSON.stringify({
    database: DB,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: failures.length,
    blocked: blocked.length,
    results,
  }, null, 2));
  await client.close();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`PATCH RUNTIME TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  process.exit(1);
});
