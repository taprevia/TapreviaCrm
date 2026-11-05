/**
 * Phase 2A-2 final extended runtime matrix (E01–E08, E10, E12, E13).
 *
 * Runs against the dedicated loopback mongod/runtime only. Redirects are never
 * followed. Failpoints are bounded, test-owned, and cleared in finally blocks.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A2_JWT_SECRET ?? '';
const PORT = 27032;
const BASE_PORT = 3201;
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; detail?: string }> = [];
let client: MongoClient;
let db: any;
let analytics: any;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_final_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== `http://127.0.0.1:${BASE_PORT}`) throw new Error('BLOCKED — wrong local base URL');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
}

async function test(id: string, fn: () => Promise<void>): Promise<void> {
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
  setCookie: string | null;
  body: string;
}

function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const match = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3201(\/.*)?$/);
  if (match) return match[1] ?? '/';
  return location;
}

async function request(rawPath: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Resp> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  const response = await fetch(`${BASE}${rawPath}`, {
    method: init.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control'),
    setCookie: response.headers.get('set-cookie'),
    body: await response.text(),
  };
}

/** Raw HTTP request, for malformed percent-encoding that fetch would normalize. */
function rawRequest(rawPath: string, init: { cookie?: string; method?: string } = {}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: BASE_PORT,
        path: rawPath,
        method: init.method ?? 'GET',
        headers: init.cookie ? { Cookie: init.cookie } : {},
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: (res.headers.location as string | undefined) ?? null,
            cacheControl: (res.headers['cache-control'] as string | undefined) ?? null,
            setCookie: (res.headers['set-cookie'] as unknown as string[] | undefined)?.join(', ') ?? null,
            body,
          })
        );
      }
    );
    req.on('timeout', () => req.destroy(new Error('raw HTTP timeout')));
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

async function userBySlug(slug: string): Promise<any> {
  const user = await db.collection('users').findOne({ bizSlug: slug });
  assert.ok(user, `missing fixture user ${slug}`);
  return user;
}
async function standeeBySlug(slug: string): Promise<any> {
  const standee = await db.collection('standees').findOne({ publicSlug: slug });
  assert.ok(standee, `missing fixture standee ${slug}`);
  return standee;
}

async function setupExtraFixtures(): Promise<void> {
  const e04 = await userBySlug('e04biz');
  const e12del = await userBySlug('e12delbiz');
  const now = new Date();

  // E04 mixed slot 3 must be an unconfigured platform (WhatsApp is not in the
  // E04 profile socialLinks).
  await db.collection('standees').updateOne(
    { publicSlug: 'e04biz/standee-5' },
    {
      $set: {
        fixedProfiles: ['google_review', 'instagram', 'whatsapp'],
        'socialQrs.2.platform': 'whatsapp',
        'socialQrs.2.label': 'whatsapp',
      },
    }
  );

  // Invalid-destination owner with no profile alias and no social links.
  const badUser = await db.collection('users').findOne({ bizSlug: 'e04badbiz' });
  let badUserId = badUser?._id;
  if (!badUser) {
    badUserId = new ObjectId();
    await db.collection('users').insertOne({
      _id: badUserId, name: 'E04 Bad Biz', email: 'e04badbiz@test.local', passwordHash: 'x',
      role: 'customer', status: 'active', bizSlug: 'e04badbiz', hasStandy: true, createdAt: now, updatedAt: now,
    });
    await db.collection('profiles').insertOne({
      userId: badUserId, displayName: 'E04 Bad Biz', companyInfo: { companyName: 'E04 Bad Biz' },
      socialLinks: [], createdAt: now, updatedAt: now,
    });
  }

  const existingBad = await db.collection('standees').findOne({ publicSlug: 'e04badbiz/standee' });
  if (!existingBad) {
    const badStandeeId = new ObjectId();
    await db.collection('standees').insertOne({
      _id: badStandeeId, userId: badUserId, name: 'E04 Invalid', displayName: 'E04 Invalid',
      publicSlug: 'e04badbiz/standee', routeSlug: 'r_e04badx', uid: 'u_e04badx',
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: 1, fixedProfiles: ['whatsapp'],
      panelQr: { qrId: 'panel_e04badbiz_standee', qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: 'soc_e04badbiz', destinationUrl: 'javascript:alert(1)', qrColor: '#000000', label: 'whatsapp' }],
      createdAt: now, updatedAt: now,
    });
    await db.collection('public_url_reservations').insertOne({
      path: 'e04badbiz/standee', kind: 'standee', instanceId: badStandeeId, ownerId: badUserId,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    });
  }

  const existingAdmin = await db.collection('users').findOne({ email: 'adminfinal@test.local' });
  if (!existingAdmin) {
    await db.collection('users').insertOne({
      _id: new ObjectId(), name: 'Final Admin', email: 'adminfinal@test.local', passwordHash: 'x',
      role: 'admin', status: 'active', createdAt: now, updatedAt: now,
    });
  }

  // Profile-only E04 owner (no socialLinks) so every slot falls back to the
  // owner's profile page.
  const profileUser = await db.collection('users').findOne({ bizSlug: 'e04profilebiz' });
  let profileUserId = profileUser?._id;
  if (!profileUser) {
    profileUserId = new ObjectId();
    await db.collection('users').insertOne({
      _id: profileUserId, name: 'E04 Profile Biz', email: 'e04profilebiz@test.local', passwordHash: 'x',
      role: 'customer', status: 'active', bizSlug: 'e04profilebiz', hasStandy: true, createdAt: now, updatedAt: now,
    });
    await db.collection('profiles').insertOne({
      userId: profileUserId, displayName: 'E04 Profile Biz', companyInfo: { companyName: 'E04 Profile Biz' },
      urlAlias: 'e04-profile-only', socialLinks: [], createdAt: now, updatedAt: now,
    });
  }
  const profileStandees = [
    {
      publicSlug: 'e04profilebiz/standee', routeSlug: 'r_e04po1', uid: 'u_e04po1',
      maxProfiles: 1, fixedProfiles: ['whatsapp'],
      slots: [{ platform: 'whatsapp', qrId: 'soc_e04po1', destinationUrl: '', qrColor: '#000000', label: 'whatsapp' }],
      panelQr: 'panel_e04po1',
    },
    {
      publicSlug: 'e04profilebiz/standee-2', routeSlug: 'r_e04pom', uid: 'u_e04pom',
      maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'],
      slots: [
        { platform: 'google_review', qrId: 'soc_e04pom1', destinationUrl: '', qrColor: '#000000', label: 'google_review' },
        { platform: 'instagram', qrId: 'soc_e04pom2', destinationUrl: '', qrColor: '#000000', label: 'instagram' },
        { platform: 'facebook', qrId: 'soc_e04pom3', destinationUrl: '', qrColor: '#000000', label: 'facebook' },
      ],
      panelQr: 'panel_e04pom',
    },
  ];
  for (const spec of profileStandees) {
    const existing = await db.collection('standees').findOne({ publicSlug: spec.publicSlug });
    if (existing) continue;
    const id = new ObjectId();
    await db.collection('standees').insertOne({
      _id: id, userId: profileUserId, name: 'E04 Profile', displayName: 'E04 Profile',
      publicSlug: spec.publicSlug, routeSlug: spec.routeSlug, uid: spec.uid,
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: spec.maxProfiles, fixedProfiles: spec.fixedProfiles,
      panelQr: { qrId: spec.panelQr, qrColor: '#000000' }, socialQrs: spec.slots,
      createdAt: now, updatedAt: now,
    });
    await db.collection('public_url_reservations').insertOne({
      path: spec.publicSlug, kind: 'standee', instanceId: id, ownerId: profileUserId,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    });
  }

  // E12's deleted fixture is recreated on reruns (the test deletes it).
  const e12Main = await db.collection('standees').findOne({ publicSlug: 'e12delbiz/standee' });
  if (!e12Main) {
    const id = new ObjectId();
    await db.collection('standees').insertOne({
      _id: id, userId: e12del._id, name: 'E12 Delete', displayName: 'E12 Delete',
      publicSlug: 'e12delbiz/standee', routeSlug: 'r_e12del', uid: 'u_e12del',
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: 1, fixedProfiles: ['whatsapp'],
      panelQr: { qrId: 'panel_e12del', qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: 'soc_e12del', destinationUrl: 'https://example.test/e12-delete', qrColor: '#000000', label: 'whatsapp' }],
      createdAt: now, updatedAt: now,
    });
  }

  // A second E12 standee used only as an invalid-destination target.
  const e12Bad = await db.collection('standees').findOne({ publicSlug: 'e12delbiz/standee-2' });
  if (!e12Bad) {
    const id = new ObjectId();
    await db.collection('standees').insertOne({
      _id: id, userId: e12del._id, name: 'E04 Invalid E12', displayName: 'E04 Invalid E12',
      publicSlug: 'e12delbiz/standee-2', routeSlug: 'r_e04bad2', uid: 'u_e04bad2',
      productKey: 'BUSINESS_PROFILE_STANDEE', maxProfiles: 1, fixedProfiles: ['whatsapp'],
      panelQr: { qrId: 'panel_e12del_2', qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: 'soc_e12bad2', destinationUrl: 'javascript:alert(1)', qrColor: '#000000', label: 'whatsapp' }],
      createdAt: now, updatedAt: now,
    });
    await db.collection('public_url_reservations').insertOne({
      path: 'e12delbiz/standee-2', kind: 'standee', instanceId: id, ownerId: e12del._id,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    });
  }
}

async function main(): Promise<void> {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  const names = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(names.includes(DB), 'test database missing');
  analytics = db.collection('analyticslogs');
  await setupExtraFixtures();

  const acme = await userBySlug('acme');
  const cardbiz = await userBySlug('cardbiz');
  const reviewpub = await userBySlug('reviewpub');
  const adminUser = await db.collection('users').findOne({ email: 'adminfinal@test.local' });
  assert.ok(adminUser, 'synthetic admin missing');

  // ── E01 NFC Card QR backward compatibility ───────────────────────────────
  await test('E01 Card /qr routeSlug + uid resolve to Card destination without Standee analytics', async () => {
    const beforeRoute = await count('route:r_e01_card');
    const beforeExternal = await countAction('tap', 'route:r_e01_card');
    const byRoute = await request('/qr/r_e01_card');
    assert.equal(byRoute.status, 302);
    assert.equal(byRoute.location, 'https://example.test/e01-card');
    assert.equal(await count('route:r_e01_card'), beforeRoute);
    const byUid = await request('/qr/u_e01_card');
    assert.equal(byUid.status, 302);
    assert.equal(byUid.location, 'https://example.test/e01-card');
    assert.equal(await count('route:r_e01_card'), beforeRoute);
    assert.equal(await countAction('tap', 'route:r_e01_card'), beforeExternal);
  });

  await test('E01 Card /qr cardUid is not a valid QR identifier (source-defined 404)', async () => {
    const before = await count('route:CARD_E01_SOCIAL');
    const res = await request('/qr/CARD_E01_SOCIAL');
    assert.equal(res.status, 404);
    assert.equal(await count('route:CARD_E01_SOCIAL'), before);
  });

  await test('E01 Card /r logs exactly one route tap and increments Card taps', async () => {
    const before = await count('route:r_e01_card');
    const cardBefore = await db.collection('cards').findOne({ routeSlug: 'r_e01_card' });
    const res = await request('/r/r_e01_card');
    assert.equal(res.status, 307);
    assert.equal(res.location, 'https://example.test/e01-card');
    assert.equal(await count('route:r_e01_card'), before + 1);
    const cardAfter = await db.collection('cards').findOne({ routeSlug: 'r_e01_card' });
    assert.equal(cardAfter.stats.taps, cardBefore.stats.taps + 1);
  });

  await test('E01 Card /t and /c preserve NFC/profile identifiers and analytics', async () => {
    const beforeTap = await countAction('tap', 'card:CARD_E01_SOCIAL');
    const beforeC = await countAction('tap', 'card:e01-social');
    const t = await request('/t/CARD_E01_SOCIAL');
    assert.equal(t.status, 302);
    assert.equal(asInternal(t.location), '/profile/e01-social?src=nfc');
    assert.equal(await countAction('tap', 'card:CARD_E01_SOCIAL'), beforeTap + 1);
    const c = await request('/c/e01-social');
    assert.equal(c.status, 307);
    assert.equal(asInternal(c.location), '/profile/e01-social');
    assert.equal(await countAction('tap', 'card:e01-social'), beforeC + 1);
  });

  await test('E01 Card profile/review surfaces do not 5xx and add no Standee events', async () => {
    const before = await count('route:r_e01_card');
    const profile = await request('/profile/e01-social');
    assert.ok(profile.status < 500, `profile status ${profile.status}`);
    const review = await request('/review/e01-social');
    assert.ok(review.status < 500, `review status ${review.status}`);
    assert.equal(await count('route:r_e01_card'), before);
  });

  await test('E01 profile Card /r uses publicSlug; /qr uses profile shim', async () => {
    const before = await count('route:r_e01_profile');
    const r = await request('/r/r_e01_profile');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/cardbiz/profile-card');
    assert.equal(await count('route:r_e01_profile'), before + 1);
    const qr = await request('/qr/r_e01_profile');
    assert.equal(qr.status, 302);
    assert.equal(asInternal(qr.location), '/profile/e01-profile');
  });

  await test('E01 suspended Card is not publicly resolvable', async () => {
    const before = await count('route:r_e01_susp');
    for (const path of ['/qr/r_e01_susp', '/r/r_e01_susp', '/c/e01-suspended', '/cardbiz/suspended-card']) {
      const res = await request(path);
      assert.equal(res.status, 404, `${path} status ${res.status}`);
    }
    assert.equal(await count('route:r_e01_susp'), before);
  });

  // ── E02 NFC Card Review Management ───────────────────────────────────────
  await test('E02 published review Card renders at branded URL (Card-first, no redirect)', async () => {
    const res = await request('/reviewpub/review-card');
    assert.equal(res.status, 200);
    assert.equal(res.location, null);
    assert.match(res.body, /Leave a review/);
  });

  await test('E02 published review Card /review and /r route correctly', async () => {
    const before = await count('route:r_e02_pub');
    const review = await request('/review/e02-published');
    assert.equal(review.status, 200);
    assert.match(review.body, /Leave a review/);
    const r = await request('/r/r_e02_pub');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/review/e02-published');
    assert.equal(await count('route:r_e02_pub'), before + 1);
    assert.equal(await countAction('review_page_view', 'standee-review:e02-published'), 0);
  });

  await test('E02 unpublished review Card fails closed and fabricates no review view', async () => {
    const before = await count('route:r_e02_unpub');
    const beforeViews = await analytics.countDocuments({ action: 'review_page_view' });
    const branded = await request('/reviewunpub/review-card');
    assert.equal(branded.status, 404);
    const review = await request('/review/e02-unpublished');
    assert.equal(review.status, 200);
    assert.match(review.body, /Review not available|Reviews aren/);
    const r = await request('/r/r_e02_unpub');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/review/e02-unpublished');
    assert.equal(await count('route:r_e02_unpub'), before + 1);
    assert.equal(await analytics.countDocuments({ action: 'review_page_view' }), beforeViews);
  });

  await test('E02 missing destination remains safe and never external', async () => {
    const branded = await request('/reviewmiss/review-card');
    assert.equal(branded.status, 200);
    assert.equal(branded.location, null);
    const review = await request('/review/e02-missing');
    assert.equal(review.status, 200);
    assert.equal(review.location, null);
  });

  await test('E02 disabled feature and invalid configuration fail closed', async () => {
    for (const path of ['/reviewdisabled/review-card', '/reviewinvalid/review-card']) {
      const res = await request(path);
      assert.equal(res.status, 404, `${path} status ${res.status}`);
    }
    for (const path of ['/review/e02-disabled', '/review/e02-invalid']) {
      const res = await request(path);
      assert.equal(res.status, 200, `${path} status ${res.status}`);
      assert.match(res.body, /Review not available|Reviews aren/);
    }
  });

  // ── E03 zero-slot multi-profile Standees ─────────────────────────────────
  await test('E03 zero-slot AIO3 delegates to picker, no review redirect, no slot tap', async () => {
    const beforeRoute = await count('route:r_zero3');
    const beforeSlot = await count('route:r_zero3/slot:1');
    const branded = await request('/acme/standee-9');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_zero3');
    assert.equal(await count('route:r_zero3'), beforeRoute);
    const r = await request('/r/r_zero3');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_zero3');
    assert.equal(await count('route:r_zero3'), beforeRoute + 1);
    const panel = await request('/panel/r_zero3');
    assert.equal(panel.status, 200);
    for (const label of ['Google Review', 'Instagram', 'Facebook']) assert.match(panel.body, new RegExp(label));
    assert.match(panel.body, /r_zero3\/1/);
    assert.doesNotMatch(panel.body, /standee-review/);
    assert.equal(await count('route:r_zero3/slot:1'), beforeSlot);
    const slot = await request('/r/r_zero3/1');
    assert.equal(slot.status, 404);
    assert.equal(await count('route:r_zero3/slot:1'), beforeSlot);
  });

  await test('E03 zero-slot AIO4 delegates to picker without slot taps', async () => {
    const before = await count('route:r_zero4');
    const branded = await request('/acme/standee-10');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_zero4');
    const r = await request('/r/r_zero4');
    assert.equal(asInternal(r.location), '/panel/r_zero4');
    assert.equal(await count('route:r_zero4'), before + 1);
    const panel = await request('/panel/r_zero4');
    assert.equal(panel.status, 200);
    assert.match(panel.body, /r_zero4\/4/);
  });

  await test('E03 truly empty Standee metadata fails closed (404, no tap)', async () => {
    const before = await analytics.countDocuments({});
    for (const path of ['/acme/standee-11', '/r/r_empty', '/panel/r_empty']) {
      const res = await request(path);
      assert.equal(res.status, 404, `${path} status ${res.status}`);
    }
    assert.equal(await analytics.countDocuments({}), before);
  });

  // ── E04 profile and social-link picker ───────────────────────────────────
  await test('E04 profile fallback slots resolve in order without slot taps', async () => {
    const before = await count('route:r_e04po1/slot:1');
    const one = await request('/r/r_e04po1/1');
    assert.equal(one.status, 307);
    assert.equal(asInternal(one.location), '/profile/e04-profile-only');
    assert.equal(await count('route:r_e04po1/slot:1'), before);

    const beforeMulti = await count('route:r_e04pom/slot:1');
    for (const slot of [1, 2, 3]) {
      const res = await request(`/r/r_e04pom/${slot}`);
      assert.equal(res.status, 307, `slot ${slot}`);
      assert.equal(asInternal(res.location), '/profile/e04-profile-only');
    }
    assert.equal(await count('route:r_e04pom/slot:1'), beforeMulti);
    const panel = await request('/panel/r_e04pom');
    assert.equal(panel.status, 200);
  });

  await test('E04 social-link slots resolve and record exactly one slot tap', async () => {
    const before = await count('route:r_e04s1/slot:1/platform:instagram');
    const one = await request('/r/r_e04s1/1');
    assert.equal(one.status, 307);
    assert.equal(one.location, 'https://example.test/e04-instagram');
    assert.equal(await count('route:r_e04s1/slot:1/platform:instagram'), before + 1);

    const beforeIg = await count('route:r_e04sm/slot:2/platform:instagram');
    const beforeFb = await count('route:r_e04sm/slot:3/platform:facebook');
    const beforeGoogle = await count('route:r_e04sm/slot:1/platform:google_review');
    assert.equal((await request('/r/r_e04sm/2')).location, 'https://example.test/e04-instagram');
    assert.equal((await request('/r/r_e04sm/3')).location, 'https://example.test/e04-facebook');
    const noGoogle = await request('/r/r_e04sm/1');
    assert.equal(noGoogle.status, 307);
    assert.equal(asInternal(noGoogle.location), '/profile/e04-profile');
    assert.equal(await count('route:r_e04sm/slot:2/platform:instagram'), beforeIg + 1);
    assert.equal(await count('route:r_e04sm/slot:3/platform:facebook'), beforeFb + 1);
    assert.equal(await count('route:r_e04sm/slot:1/platform:google_review'), beforeGoogle);
  });

  await test('E04 mixed direct/social/missing slots are isolated', async () => {
    const beforeDirect = await count('route:r_e04mix/slot:1/platform:google_review');
    const beforeSocial = await count('route:r_e04mix/slot:2/platform:instagram');
    const beforeMissing = await count('route:r_e04mix/slot:3/platform:whatsapp');
    const direct = await request('/r/r_e04mix/1');
    assert.equal(direct.location, 'https://example.test/e04-mix-direct');
    const social = await request('/r/r_e04mix/2');
    assert.equal(social.location, 'https://example.test/e04-instagram');
    const missing = await request('/r/r_e04mix/3');
    assert.equal(missing.status, 307);
    assert.equal(asInternal(missing.location), '/profile/e04-profile');
    assert.equal(await count('route:r_e04mix/slot:1/platform:google_review'), beforeDirect + 1);
    assert.equal(await count('route:r_e04mix/slot:2/platform:instagram'), beforeSocial + 1);
    assert.equal(await count('route:r_e04mix/slot:3/platform:whatsapp'), beforeMissing);
  });

  await test('E04 invalid/missing links fail closed with no slot tap', async () => {
    const before = await count('route:r_e04badx/1/platform:whatsapp');
    for (const path of ['/r/r_e04badx/1', '/r/r_e04bad2/1']) {
      const res = await request(path);
      assert.equal(res.status, 404, `${path} status ${res.status}`);
    }
    assert.equal(await count('route:r_e04badx/1/platform:whatsapp'), before);
  });

  await test('E04 legacy AIO keeps picker and preserves slot behavior', async () => {
    const beforeRoute = await count('route:r_e04legacy');
    const beforeSlot = await count('route:r_e04legacy/slot:1/platform:instagram');
    const branded = await request('/e04biz/standee-7');
    assert.equal(branded.status, 200);
    assert.equal(await count('route:r_e04legacy'), beforeRoute);
    const r = await request('/r/r_e04legacy');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_e04legacy');
    assert.equal(await count('route:r_e04legacy'), beforeRoute + 1);
    const slot = await request('/r/r_e04legacy/1');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/e04-legacy-ig');
    assert.equal(await count('route:r_e04legacy/slot:1/platform:instagram'), beforeSlot + 1);
  });

  // ── E05 multiple authentication cookies ──────────────────────────────────
  await test('E05 duplicate/invalid/malformed cookies never grant protected access', async () => {
    const validCustomer = token(String(acme._id), 'customer');
    const validAdmin = token(String(adminUser._id), 'admin');
    const invalid = 'not-a-token';

    for (const cookie of [
      `token=${invalid}; token=${validCustomer}`,
      `token=${validCustomer}; token=${invalid}`,
      `token=%%%bad%%%; token=${validCustomer}`,
    ]) {
      const pub = await request('/acme/standee', { cookie });
      assert.equal(pub.status, 307, `public status for ${cookie.slice(0, 24)}`);
      assert.equal(pub.location, '/r/r_single');
    }

    // Next's cookie parser resolves duplicate names to the last value. A valid
    // credential present last is a legitimate credential; an invalid last value
    // must deny access. Neither case invents admin access.
    const invalidFirst = await request('/admin', { cookie: `token=${invalid}; token=${validCustomer}` });
    assert.equal(invalidFirst.status, 307);
    assert.equal(asInternal(invalidFirst.location), '/dashboard');

    const customerFirst = await request('/admin', { cookie: `token=${validCustomer}; token=${invalid}` });
    assert.equal(customerFirst.status, 307);
    assert.equal(asInternal(customerFirst.location), '/login');

    const adminFirst = await request('/admin', { cookie: `token=${invalid}; token=${validAdmin}` });
    assert.ok(!(adminFirst.status === 307 && asInternal(adminFirst.location) === '/login'), 'admin cookie was denied');
  });

  await test('E05 missing/expired/malformed JWT keeps public public and protected closed', async () => {
    const publicNoCookie = await request('/acme/standee');
    assert.equal(publicNoCookie.status, 307);
    assert.equal(publicNoCookie.location, '/r/r_single');

    const expired = token(String(acme._id), 'customer', { expired: true });
    const expiredPublic = await request('/acme/standee', { cookie: `token=${expired}` });
    assert.equal(expiredPublic.status, 307);
    assert.equal(expiredPublic.location, '/r/r_single');

    for (const cookie of [`token=${expired}`, 'token=%%%bad%%%', 'token=bad']) {
      const api = await request('/api/standees', { cookie });
      assert.ok([401, 403].includes(api.status), `api status ${api.status}`);
    }
  });

  await test('E05 tenant isolation: each JWT sees only its own Standees', async () => {
    for (const [user, slug] of [[acme, 'acme'], [reviewpub, 'reviewpub']] as const) {
      const res = await request('/api/standees', { cookie: `token=${token(String(user._id))}` });
      assert.equal(res.status, 200, `${slug} status ${res.status}`);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body.standees) && body.standees.length > 0);
      for (const standee of body.standees) {
        assert.equal(String(standee.userId), String(user._id), `${slug} leaked another tenant`);
      }
    }
  });

  // ── E06 double-encoded and malformed URLs ────────────────────────────────
  await test('E06 double-encoded/malformed paths cannot bypass auth or open redirects', async () => {
    const cases = [
      '/acme%252Fstandee',
      '/acme/%252e%252e/admin',
      '/acme%5Cstandee',
      '/acme//standee',
      '/ACME/Standee',
      '/acme/standee?next=https://evil.test',
      '/acme/standee%2F..%2Fadmin',
      '/acme/%2e%2e/admin',
      '/r/r_single%252F..%252Fr_single2',
      '/r/%2e%2e/r_single2',
    ];
    for (const path of cases) {
      const beforeSingle = await count('route:r_single');
      const beforeSingle2 = await count('route:r_single2');
      const res = await rawRequest(path);
      assert.ok(res.status < 500, `${path} status ${res.status}`);
      const loc = asInternal(res.location) ?? '';
      assert.ok(!/^javascript:|^data:|^\/\//i.test(loc), `${path} unsafe location ${loc}`);
      if (res.status >= 400) {
        assert.equal(await count('route:r_single'), beforeSingle, `${path} wrote route event`);
        assert.equal(await count('route:r_single2'), beforeSingle2, `${path} wrote route event`);
      }
    }

    const malformed = await rawRequest('/acme/%E0%A4%A');
    assert.ok(malformed.status < 500, `malformed status ${malformed.status}`);

    const bypass = await rawRequest('/admin%252Fstandee', { cookie: 'token=bad' });
    assert.ok(bypass.status < 500);
    assert.ok(!(bypass.status === 200 && /dashboard|admin/i.test(bypass.body)), 'encoded admin bypass');
  });

  // ── E07 Card collision lookup failure ────────────────────────────────────
  results.push({
    id: 'E07 Card collision preflight failure injection',
    status: 'BLOCKED',
    detail:
      'No safe query-targeted failpoint can isolate the second cards find (collision preflight) from the first cards find (Card-first publicSlug lookup) without also failing the Card-first lookup and returning 500. R06 still proves the real collision path keeps the picker; source catch is fail-closed.',
  });
  console.log('BLOCKED E07 Card collision preflight failure injection');

  // ── E08 analytics write failure ──────────────────────────────────────────
  await test('E08 analytics insert failure is fail-open, no duplicate, correct destination', async () => {
    const before = await count('route:r_single');
    try {
      await setFailpoint({ times: 1 }, {
        failCommands: ['insert'],
        namespace: `${DB}.analyticslogs`,
        errorCode: 2,
      });
      const res = await request('/r/r_single');
      assert.equal(res.status, 307);
      assert.equal(res.location, 'https://example.test/final-single');
      assert.equal(await count('route:r_single'), before, 'failed write produced an event');
    } finally {
      await clearFailpoint();
    }
    const after = await request('/r/r_single');
    assert.equal(after.status, 307);
    assert.equal(after.location, 'https://example.test/final-single');
    assert.equal(await count('route:r_single'), before + 1, 'recovery write missing or duplicated');
  });

  // ── E10 bounded MongoDB query failure/timeout ────────────────────────────
  await test('E10 bounded standee query failure returns generic 500, no redirect or analytics', async () => {
    const before = await count('route:r_single');
    try {
      await setFailpoint({ times: 1 }, {
        failCommands: ['find'],
        namespace: `${DB}.standees`,
        errorCode: 50,
      });
      const res = await request('/r/r_single');
      assert.equal(res.status, 500);
      assert.equal(res.location, null);
      assert.match(res.body, /Internal server error/);
      assert.equal(await count('route:r_single'), before);
    } finally {
      await clearFailpoint();
    }
    const recovered = await request('/r/r_single');
    assert.equal(recovered.status, 307);
    assert.equal(recovered.location, 'https://example.test/final-single');
    assert.equal(await count('route:r_single'), before + 1);
  });

  // ── E12 suspended, deleted, and missing Standee ──────────────────────────
  await test('E12 missing publicSlug is non-informative 404 with no analytics', async () => {
    const before = await analytics.countDocuments({});
    const res = await request('/e12missing/standee');
    assert.equal(res.status, 404);
    assert.equal(await analytics.countDocuments({}), before);
  });

  await test('E12 deleted Standee leaves 404 and never resolves another customer', async () => {
    const standee = await standeeBySlug('e12delbiz/standee');
    const before = await count(`route:${standee.routeSlug}`);
    const beforeCount = await count(`route:${standee.routeSlug}`);
    const alive = await request('/e12delbiz/standee');
    assert.equal(alive.status, 307);
    await db.collection('standees').deleteOne({ _id: standee._id });
    const deleted = await request('/e12delbiz/standee');
    assert.equal(deleted.status, 404);
    const deletedRoute = await request(`/r/${standee.routeSlug}`);
    assert.equal(deletedRoute.status, 404);
    assert.equal(await count(`route:${standee.routeSlug}`), beforeCount);
    // Different synthetic tenant must not become the answer.
    const other = await request('/e12suspbiz/standee');
    assert.equal(other.status, 307);
    assert.equal(other.location, '/r/r_e12susp');
    assert.equal(await count(`route:${standee.routeSlug}`), before);
  });

  await test('E12 suspended owner does not gate public Standee (existing behavior)', async () => {
    const before = await count('route:r_e12susp');
    const branded = await request('/e12suspbiz/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_e12susp');
    const r = await request('/r/r_e12susp');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/e12-suspended');
    assert.equal(await count('route:r_e12susp'), before + 1);
  });

  // ── E13 representative regression ────────────────────────────────────────
  await test('E13 single Standee delegation, cache, and one route tap', async () => {
    const before = await count('route:r_single');
    const branded = await request('/acme/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_single');
    assert.match(branded.cacheControl ?? '', /no-store/);
    assert.notEqual(branded.status, 301);
    assert.notEqual(branded.status, 308);
    assert.equal(await count('route:r_single'), before);
    const r = await request('/r/r_single');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/final-single');
    assert.match(r.cacheControl ?? '', /no-store/);
    assert.equal(await count('route:r_single'), before + 1);
  });

  await test('E13 AIO3/AIO4 route tap and separate slot taps', async () => {
    const before3 = await count('route:r_aio3');
    const before3Slot = await count('route:r_aio3/slot:1/platform:google_review');
    const branded3 = await request('/acme/standee-4');
    assert.equal(branded3.location, '/r/r_aio3');
    const r3 = await request('/r/r_aio3');
    assert.equal(asInternal(r3.location), '/panel/r_aio3');
    assert.equal(await count('route:r_aio3'), before3 + 1);
    const panel3 = await request('/panel/r_aio3');
    assert.equal(panel3.status, 200);
    const slot3 = await request('/r/r_aio3/1');
    assert.equal(slot3.location, 'https://example.test/final-aio3-google');
    assert.equal(await count('route:r_aio3/slot:1/platform:google_review'), before3Slot + 1);

    const before4 = await count('route:r_aio4');
    const branded4 = await request('/acme/standee-5');
    assert.equal(branded4.location, '/r/r_aio4');
    const r4 = await request('/r/r_aio4');
    assert.equal(asInternal(r4.location), '/panel/r_aio4');
    assert.equal(await count('route:r_aio4'), before4 + 1);
  });

  await test('E13 eligible review host writes one route tap and one review page view', async () => {
    const beforeRoute = await count('route:r_reviewpub');
    const beforeView = await countAction('review_page_view', 'standee-review:r_reviewpub');
    const branded = await request('/reviewpub/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_reviewpub');
    const r = await request('/r/r_reviewpub');
    assert.equal(asInternal(r.location), '/standee-review/r_reviewpub');
    assert.equal(await count('route:r_reviewpub'), beforeRoute + 1);
    const review = await request('/standee-review/r_reviewpub');
    assert.equal(review.status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_reviewpub'), beforeView + 1);
  });

  await test('E13 legacy AIO, collision, and same-origin loop keep pickers', async () => {
    const legacyBefore = await count('route:r_legacy');
    assert.equal((await request('/acme/standee-6')).status, 200);
    assert.equal(await count('route:r_legacy'), legacyBefore);

    const collideBefore = await count('route:r_collide');
    assert.equal((await request('/acme/standee-7')).status, 200);
    assert.equal(await count('route:r_collide'), collideBefore);

    const loopBefore = await count('route:r_self');
    assert.equal((await request('/acme/standee-8')).status, 200);
    assert.equal(await count('route:r_self'), loopBefore);
  });

  await test('E13 HEAD semantics: branded HEAD writes nothing, /r HEAD writes once', async () => {
    const before = await count('route:r_single');
    const headBranded = await request('/acme/standee', { method: 'HEAD' });
    assert.equal(headBranded.status, 307);
    assert.equal(headBranded.location, '/r/r_single');
    assert.equal(await count('route:r_single'), before);
    const headR = await request('/r/r_single', { method: 'HEAD' });
    assert.equal(headR.status, 307);
    assert.equal(await count('route:r_single'), before + 1);
  });

  await test('E13 prefetch/repeated branded GET writes nothing', async () => {
    const before = await count('route:r_single');
    const prefetch = await request('/acme/standee', {
      headers: { 'Next-Router-Prefetch': '1', Purpose: 'prefetch' },
    });
    assert.equal(prefetch.status, 307);
    await request('/acme/standee');
    await request('/acme/standee');
    assert.equal(await count('route:r_single'), before);
  });

  await test('E13 historical analytics unchanged', async () => {
    const doc = await analytics.findOne({ metadata: 'historical:final' });
    assert.ok(doc);
    assert.equal(doc.action, 'tap');
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
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`FINAL RUNTIME TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try {
    await client?.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
