/**
 * Phase 2A-2 extended local runtime validation.
 *
 * Covers the remaining report matrix: path attack inputs, HEAD/prefetch,
 * legacy Card and Standee routes, review-host eligibility, and tenant-isolated
 * APIs. Assumes the dedicated test mongod and sanitized Next.js runtime are
 * already running. Never follows redirects; never contacts external URLs.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A2_JWT_SECRET ?? '';
const PID = process.env.PHASE2A2_TEST_PID ?? '';
const STORAGE = process.env.PHASE2A2_TEST_STORAGE ?? '';
const PORT = 27031;
const results: Array<{ id: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];
let client: MongoClient;
let analytics: any;
let db: any;
let ids: { acme: string; review: string; review2: string };

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_isolated_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== 'http://127.0.0.1:3200') throw new Error('BLOCKED — wrong local base URL');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
  const cmd = execFileSync('ps', ['-p', PID, '-o', 'command='], { encoding: 'utf8' });
  if (!cmd.includes('mongod') || !cmd.includes(`--dbpath ${STORAGE}/db`) || !cmd.includes(`--port ${PORT}`) || !cmd.includes('--bind_ip 127.0.0.1')) {
    throw new Error('BLOCKED — PID is not the dedicated test mongod');
  }
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
  body: string;
}

function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const match = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3200(\/.*)?$/);
  if (match) return match[1] ?? '/';
  return location;
}

async function http(
  pathname: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}
): Promise<Resp> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.Cookie = init.cookie;
  const response = await fetch(`${BASE}${pathname}`, {
    method: init.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
}

async function count(metadata: string): Promise<number> {
  return analytics.countDocuments({ metadata });
}

async function countAction(action: string, metadata: string): Promise<number> {
  return analytics.countDocuments({ action, metadata });
}

const token = (userId: string, role = 'customer', opts: { expired?: boolean } = {}) =>
  jwt.sign({ userId, role }, SECRET, { expiresIn: opts.expired ? '-1s' : '1h' });

async function ensureAssignments(): Promise<void> {
  const now = new Date();
  const acmeStandee = await db.collection('standees').findOne({ publicSlug: 'acme/standee' });
  const reviewStandee = await db.collection('standees').findOne({ publicSlug: 'reviewbiz/standee' });
  const review2Standee = await db.collection('standees').findOne({ publicSlug: 'reviewbiz2/standee' });

  async function ensureProduct(slug: string, name: string, category: string): Promise<ObjectId> {
    const existing = await db.collection('catalogproducts').findOne({ slug });
    if (existing) return existing._id as ObjectId;
    const _id = new ObjectId();
    await db.collection('catalogproducts').insertOne({
      _id, name, slug, kind: 'standee', category, active: true, priceMinor: 0, sortOrder: 1,
      createdAt: now, updatedAt: now,
    });
    return _id;
  }

  async function ensureAssignment(userId: string, catalogProductId: ObjectId, standeeId: unknown): Promise<void> {
    const userObjectId = new ObjectId(userId);
    const existing = await db.collection('userproducts').findOne({ userId: userObjectId, catalogProductId, standeeId });
    if (existing) return;
    await db.collection('userproducts').insertOne({
      _id: new ObjectId(), userId: userObjectId, catalogProductId, standeeId, status: 'active', quantity: 1,
      unitPriceMinor: 0, createdAt: now, updatedAt: now,
    });
  }

  const business = await ensureProduct('business-profile-standee', 'Business Profile Standee', 'standee');
  const review = await ensureProduct('google-review-standee', 'Google Review Standee', 'standee');
  await ensureAssignment(ids.acme, business, acmeStandee?._id);
  await ensureAssignment(ids.review, review, reviewStandee?._id);
  await ensureAssignment(ids.review2, review, review2Standee?._id);
}

async function main(): Promise<void> {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  const existing = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(existing.includes(DB), 'test database missing');
  analytics = db.collection('analyticslogs');

  const users = await db.collection('users').find({ bizSlug: { $in: ['acme', 'reviewbiz', 'reviewbiz2'] } }).toArray();
  const bySlug = new Map<string, string>(
    users.map((u: any) => [String(u.bizSlug), String(u._id)] as [string, string])
  );
  ids = { acme: bySlug.get('acme')!, review: bySlug.get('reviewbiz')!, review2: bySlug.get('reviewbiz2')! };
  assert.ok(ids.acme && ids.review && ids.review2, 'fixture users missing');
  await ensureAssignments();

  await test('X01 encoded/mixed-case/duplicate-slash/dot-segment branded paths stay safe', async () => {
    const before = await count('route:r_single');
    for (const path of ['/ACME/Standee', '/%61cme/standee', '/acme/standee?utm=1&next=https://evil.test']) {
      const res = await http(path);
      assert.equal(res.status, 307, `${path} status`);
      assert.equal(asInternal(res.location), '/r/r_single', `${path} location`);
    }
    for (const path of ['/acme/standee/', '/acme//standee', '/acme/./standee']) {
      const res = await http(path);
      assert.ok([307, 308].includes(res.status), `${path} status ${res.status}`);
      if (res.status === 308) assert.equal(asInternal(res.location), '/acme/standee', `${path} normalize`);
    }
    for (const path of ['/acme/standee%2F..%2Fadmin', '/acme%2Fstandee', '/acme\\standee']) {
      const res = await http(path);
      assert.ok(res.status < 500, `${path} status ${res.status}`);
      if (res.status >= 400) continue;
      const loc = asInternal(res.location) ?? '';
      assert.ok(
        loc === '/r/r_single' || loc.startsWith('/login'),
        `${path} must normalize internally or reach login, got ${loc}`
      );
    }
    // Dot segments normalize to the protected /admin/standee route: middleware
    // must send the unauthenticated visitor to login, never to a Standee.
    const dotSegment = await http('/acme/../admin/standee');
    assert.equal(dotSegment.status, 307);
    assert.match(dotSegment.location ?? '', /^\/login\?redirect=/);
    assert.equal(await count('route:r_single'), before, 'no branded-page analytics');
  });

  await test('X02 /r ignores query manipulation and encoded route keys', async () => {
    const before = await count('route:r_single');
    for (const path of ['/r/r_single?next=//evil.test', '/r/r_single?url=https://evil.test', '/r/%72_single']) {
      const res = await http(path);
      assert.equal(res.status, 307, `${path} status`);
      assert.equal(res.location, 'https://example.test/single', `${path} location`);
    }
    assert.equal(await count('route:r_single'), before + 3);
    for (const path of ['/r/r_single%2F..%2Fr_single2', '/r/..%2Fr_single']) {
      const res = await http(path);
      assert.ok(res.status >= 400 && res.status < 500, `${path} status ${res.status}`);
    }
  });

  await test('X03 HEAD /r keeps existing analytics semantics', async () => {
    const before = await count('route:r_single');
    const res = await http('/r/r_single', { method: 'HEAD' });
    assert.equal(res.status, 307);
    assert.equal(res.location, 'https://example.test/single');
    const after = await count('route:r_single');
    // Document actual semantics rather than assume bot filtering.
    assert.ok(after === before || after === before + 1, `unexpected HEAD delta ${after - before}`);
    console.log(`  HEAD /r route tap delta = ${after - before}`);
  });

  await test('X04 prefetch/repeated branded GET never writes analytics', async () => {
    const before = await count('route:r_single');
    const prefetch = await http('/acme/standee', { headers: { 'Next-Router-Prefetch': '1', Purpose: 'prefetch' } });
    assert.equal(prefetch.status, 307);
    await http('/acme/standee');
    await http('/acme/standee');
    assert.equal(await count('route:r_single'), before);
  });

  await test('X05 legacy panel routes render picker without route taps', async () => {
    const before = await count('route:r_single');
    const panel = await http('/panel/r_single');
    assert.equal(panel.status, 200);
    const byUid = await http('/panel/u_uid');
    assert.equal(byUid.status, 200);
    const aio = await http('/panel/r_aio3');
    assert.equal(aio.status, 200);
    assert.equal(await count('route:r_single'), before);
  });

  await test('X06 NFC /t resolves both routeSlug and cardUid with card analytics', async () => {
    const beforeUid = await countAction('tap', 'card:CARD_SOCIAL');
    const beforeRoute = await countAction('tap', 'card:r_card');
    const byUid = await http('/t/CARD_SOCIAL');
    assert.equal(byUid.status, 302);
    assert.equal(asInternal(byUid.location), '/profile/acme-card?src=nfc');
    assert.equal(await countAction('tap', 'card:CARD_SOCIAL'), beforeUid + 1);
    const byRoute = await http('/t/r_card');
    assert.equal(byRoute.status, 302);
    assert.equal(asInternal(byRoute.location), '/profile/acme-card?src=nfc');
    assert.equal(await countAction('tap', 'card:r_card'), beforeRoute + 1);
  });

  await test('X07 legacy /c resolves alias and cardUid with card analytics', async () => {
    const beforeAlias = await countAction('tap', 'card:acme-card');
    const beforeUid = await countAction('tap', 'card:CARD_SOCIAL');
    const byAlias = await http('/c/acme-card');
    assert.equal(byAlias.status, 307);
    assert.equal(asInternal(byAlias.location), '/profile/acme-card');
    assert.equal(await countAction('tap', 'card:acme-card'), beforeAlias + 1);
    const byUid = await http('/c/CARD_SOCIAL');
    assert.equal(byUid.status, 307);
    assert.equal(asInternal(byUid.location), '/profile/acme-card');
    assert.equal(await countAction('tap', 'card:CARD_SOCIAL'), beforeUid + 1);
  });

  await test('X08 Card profile/review surfaces do not 500 and add no standee events', async () => {
    const beforeRoute = await count('route:r_single');
    const profile = await http('/profile/acme-card');
    assert.ok(profile.status < 500, `profile status ${profile.status}`);
    const review = await http('/review/acme-card');
    assert.ok(review.status < 500, `review status ${review.status}`);
    assert.equal(await count('route:r_single'), beforeRoute);
  });

  await test('X09 eligible review host writes exactly one review page view', async () => {
    const beforeView = await countAction('review_page_view', 'standee-review:r_review');
    const beforeRoute = await count('route:r_review');
    const res = await http('/standee-review/r_review');
    assert.equal(res.status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_review'), beforeView + 1);
    assert.equal(await count('route:r_review'), beforeRoute);
  });

  await test('X10 ineligible review host fails closed with no review event', async () => {
    const beforeView = await countAction('review_page_view', 'standee-review:r_review2');
    const res = await http('/standee-review/r_review2');
    assert.equal(res.status, 200, `status ${res.status}`);
    assert.match(res.body, /Review not available|Reviews aren/, 'expected fail-closed unavailable page');
    assert.equal(await countAction('review_page_view', 'standee-review:r_review2'), beforeView);
  });

  await test('X11 customer JWT sees only its own standees', async () => {
    const acme = await http('/api/standees', { cookie: `token=${token(ids.acme)}` });
    assert.equal(acme.status, 200, `acme status ${acme.status}`);
    const acmeBody = JSON.parse(acme.body);
    assert.ok(Array.isArray(acmeBody.standees) && acmeBody.standees.length > 0);
    for (const standee of acmeBody.standees) {
      assert.equal(String(standee.userId), ids.acme, 'acme response leaked another tenant');
      assert.notEqual(standee.routeSlug, 'r_review');
    }

    const review = await http('/api/standees', { cookie: `token=${token(ids.review)}` });
    assert.equal(review.status, 200, `review status ${review.status}`);
    const reviewBody = JSON.parse(review.body);
    assert.ok(Array.isArray(reviewBody.standees) && reviewBody.standees.length > 0);
    for (const standee of reviewBody.standees) {
      assert.equal(String(standee.userId), ids.review, 'review response leaked another tenant');
    }
  });

  await test('X12 cross-tenant/expired/malformed JWT cannot reach protected APIs', async () => {
    const noCapability = await http('/api/standees', { cookie: `token=${token(ids.acme, 'admin')}` });
    assert.ok([200, 403].includes(noCapability.status), `admin status ${noCapability.status}`);
    const expired = await http('/api/standees', { cookie: `token=${token(ids.acme, 'customer', { expired: true })}` });
    assert.ok([401, 403].includes(expired.status), `expired status ${expired.status}`);
    const malformed = await http('/api/standees', { cookie: 'token=%%%not-a-jwt%%%' });
    assert.ok([401, 403].includes(malformed.status), `malformed status ${malformed.status}`);
    const none = await http('/api/standees');
    assert.ok([401, 403].includes(none.status), `none status ${none.status}`);
  });

  await test('X13 branded entry with a foreign tenant JWT still resolves only the requested Standee', async () => {
    const before = await count('route:r_single');
    const res = await http('/acme/standee', { cookie: `token=${token(ids.review)}` });
    assert.equal(res.status, 307);
    assert.equal(asInternal(res.location), '/r/r_single');
    assert.equal(await count('route:r_single'), before);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ database: DB, results, passed: results.length - failures.length, failed: failures.length }, null, 2));
  await client.close();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`EXTENDED TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
