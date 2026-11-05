/**
 * Phase 2A-2 local HTTP runtime validation.
 *
 * Assumes the dedicated loopback test mongod and sanitized Next.js runtime are
 * already running. It never follows redirects and never contacts external URLs.
 */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A2_JWT_SECRET ?? '';
const PORT = 27031;
const results: Array<{ id: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];
let client: MongoClient;
let analytics: any;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_isolated_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== 'http://127.0.0.1:3200') throw new Error('BLOCKED — wrong local base URL');
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

async function http(pathname: string, init: { method?: string; cookie?: string } = {}): Promise<Resp> {
  const headers: Record<string, string> = {};
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
    setCookie: response.headers.get('set-cookie'),
    body: await response.text(),
  };
}

/**
 * Normalize an internal redirect Location to path+query.
 *
 * The existing `/r` and `/qr` handlers use NextResponse.redirect, which emits
 * an absolute same-origin URL, while the Phase 2A-2 branded page emits a
 * relative path. Both are internal. External destinations are returned as-is.
 */
function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const match = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3200(\/.*)?$/);
  if (match) return match[1] ?? '/';
  return location;
}

async function count(metadata: string): Promise<number> {
  return analytics.countDocuments({ metadata });
}

async function countAction(action: string, metadata: string): Promise<number> {
  return analytics.countDocuments({ action, metadata });
}

const token = (role: string, opts: { expired?: boolean; wrong?: boolean } = {}) =>
  jwt.sign(
    { userId: '000000000000000000000001', role },
    opts.wrong ? 'wrong-secret-that-is-long-enough-for-test' : SECRET,
    { expiresIn: opts.expired ? '-1s' : '1h' }
  );

async function main(): Promise<void> {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(DB);
  const existing = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
  assert.ok(existing.includes(DB), 'test database missing');
  analytics = db.collection('analyticslogs');

  await test('R01 single configured delegates and records one route tap', async () => {
    const before = await count('route:r_single');
    const page = await http('/acme/standee');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_single');
    assert.match(page.cacheControl ?? '', /no-store/);
    assert.equal(await count('route:r_single'), before);

    const r = await http('/r/r_single');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/single');
    assert.equal(await count('route:r_single'), before + 1);
  });

  await test('R02 second configured Standee delegates independently', async () => {
    const before = await count('route:r_single2');
    const page = await http('/acme/standee-2');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_single2');
    const r = await http('/r/r_single2');
    assert.equal(r.location, 'https://example.test/single2');
    assert.equal(await count('route:r_single2'), before + 1);
  });

  await test('R03 unconfigured single keeps picker and records no route tap', async () => {
    const before = await count('route:r_unconfig');
    const page = await http('/acme/standee-3');
    assert.equal(page.status, 200);
    assert.equal(page.location, null);
    assert.equal(await count('route:r_unconfig'), before);
  });

  await test('R04 UID fallback delegates and records one route tap', async () => {
    const before = await count('route:u_uid');
    const page = await http('/acme/standee-8');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/u_uid');
    const r = await http('/r/u_uid');
    assert.equal(r.location, 'https://example.test/uid');
    assert.equal(await count('route:u_uid'), before + 1);
  });

  await test('R05 missing routeSlug and UID keeps picker', async () => {
    const before = await count('route:undefined');
    const page = await http('/acme/standee-7');
    assert.equal(page.status, 200);
    assert.equal(await count('route:undefined'), before);
  });

  await test('R06 Card route collision keeps picker', async () => {
    const before = await count('route:r_collide');
    const page = await http('/acme/standee-9');
    assert.equal(page.status, 200);
    assert.equal(await count('route:r_collide'), before);
  });

  await test('R08 same-origin self destination keeps picker', async () => {
    const before = await count('route:r_self');
    const page = await http('/acme/standee-10');
    assert.equal(page.status, 200);
    assert.equal(await count('route:r_self'), before);
  });

  await test('R09 cross-branded cycle keeps picker', async () => {
    const beforeA = await count('route:r_cycle_a');
    const beforeB = await count('route:r_cycle_b');
    const a = await http('/acme/standee-11');
    const b = await http('/acme/standee-12');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await count('route:r_cycle_a'), beforeA);
    assert.equal(await count('route:r_cycle_b'), beforeB);
  });

  await test('R10 unsafe and relative destinations keep picker', async () => {
    const before = await count('route:r_unsafe');
    const cred = await count('route:r_cred');
    const rel = await count('route:r_rel');
    for (const path of ['/acme/standee-13', '/acme/standee-14', '/acme/standee-15']) {
      const res = await http(path);
      assert.equal(res.status, 200);
    }
    assert.equal(await count('route:r_unsafe'), before);
    assert.equal(await count('route:r_cred'), cred);
    assert.equal(await count('route:r_rel'), rel);
  });

  await test('A02 modern AIO 3 delegates, picker stays, slot event is separate', async () => {
    const beforeRoute = await count('route:r_aio3');
    const beforeSlot = await count('route:r_aio3/slot:1/platform:google_review');
    const page = await http('/acme/standee-4');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_aio3');
    assert.equal(await count('route:r_aio3'), beforeRoute);

    const r = await http('/r/r_aio3');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_aio3');
    assert.equal(await count('route:r_aio3'), beforeRoute + 1);

    const panel = await http('/panel/r_aio3');
    assert.equal(panel.status, 200);
    assert.equal(await count('route:r_aio3'), beforeRoute + 1);

    const slot = await http('/r/r_aio3/1');
    assert.equal(slot.status, 307);
    assert.equal(slot.location, 'https://example.test/aio3-google');
    assert.equal(await count('route:r_aio3/slot:1/platform:google_review'), beforeSlot + 1);
  });

  await test('A03 modern AIO 4 delegates and keeps picker', async () => {
    const before = await count('route:r_aio4');
    const page = await http('/acme/standee-5');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_aio4');
    const r = await http('/r/r_aio4');
    assert.equal(asInternal(r.location), '/panel/r_aio4');
    assert.equal(await count('route:r_aio4'), before + 1);
    assert.equal((await http('/panel/r_aio4')).status, 200);
  });

  await test('A04 legacy AIO keeps branded picker and no route tap', async () => {
    const before = await count('route:r_legacy');
    const page = await http('/acme/standee-6');
    assert.equal(page.status, 200);
    assert.equal(await count('route:r_legacy'), before);
    const r = await http('/r/r_legacy');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/panel/r_legacy');
  });

  await test('A06 eligible Google Review delegates and preserves review page view', async () => {
    const beforeRoute = await count('route:r_review');
    const beforeView = await countAction('review_page_view', 'standee-review:r_review');
    const page = await http('/reviewbiz/standee');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_review');
    assert.equal(await count('route:r_review'), beforeRoute);

    const r = await http('/r/r_review');
    assert.equal(r.status, 307);
    assert.equal(asInternal(r.location), '/standee-review/r_review');
    assert.equal(await count('route:r_review'), beforeRoute + 1);

    const review = await http('/standee-review/r_review');
    assert.equal(review.status, 200);
    assert.equal(await countAction('review_page_view', 'standee-review:r_review'), beforeView + 1);
    assert.equal(await count('route:r_review'), beforeRoute + 1);
  });

  await test('A07 ineligible Google Review uses external fallback, no review view', async () => {
    const beforeRoute = await count('route:r_review2');
    const beforeView = await countAction('review_page_view', 'standee-review:r_review2');
    const page = await http('/reviewbiz2/standee');
    assert.equal(page.status, 307);
    assert.equal(page.location, '/r/r_review2');
    const r = await http('/r/r_review2');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/google-review2');
    assert.equal(await count('route:r_review2'), beforeRoute + 1);
    assert.equal(await countAction('review_page_view', 'standee-review:r_review2'), beforeView);
  });

  await test('A09/A10 legacy /r and /qr retain metadata semantics', async () => {
    const beforeRoute = await count('route:r_single');
    const beforePanel = await count('qr-panel:panel_single');
    const beforeSocial = await count('qr-panel:soc_single');
    const r = await http('/r/r_single');
    assert.equal(r.status, 307);
    assert.equal(r.location, 'https://example.test/single');
    assert.equal(await count('route:r_single'), beforeRoute + 1);

    const panel = await http('/qr/panel_single');
    assert.equal(panel.status, 307);
    assert.equal(asInternal(panel.location), '/panel/r_single');
    assert.equal(await count('qr-panel:panel_single'), beforePanel + 1);

    const social = await http('/qr/soc_single');
    assert.equal(social.status, 302);
    assert.equal(social.location, 'https://example.test/single');
    assert.equal(await count('qr-panel:soc_single'), beforeSocial);
  });

  await test('A11 Card first and Card analytics unchanged', async () => {
    const beforeSocial = await analytics.countDocuments({ action: 'social_redirect', metadata: 'alias:acme-card' });
    const beforeRoute = await count('route:r_card');
    const cardPage = await http('/acme/business-card');
    assert.equal(cardPage.status, 307);
    assert.equal(cardPage.location, 'https://example.test/card');
    assert.equal(await analytics.countDocuments({ action: 'social_redirect', metadata: 'alias:acme-card' }), beforeSocial + 1);

    const cardRoute = await http('/r/r_card');
    assert.equal(cardRoute.status, 307);
    assert.equal(cardRoute.location, 'https://example.test/card');
    assert.equal(await count('route:r_card'), beforeRoute + 1);
  });

  await test('A12 repeat /r scans add one route tap each', async () => {
    const before = await count('route:r_single2');
    await http('/r/r_single2');
    await http('/r/r_single2');
    assert.equal(await count('route:r_single2'), before + 2);
  });

  await test('A13 HEAD and refresh do not add branded-page events', async () => {
    const before = await count('route:r_single');
    const head = await http('/acme/standee', { method: 'HEAD' });
    assert.equal(head.status, 307);
    assert.equal(head.location, '/r/r_single');
    assert.equal(await count('route:r_single'), before);
    await http('/acme/standee');
    assert.equal(await count('route:r_single'), before);
  });

  await test('A15 historical analytics record unchanged', async () => {
    const doc = await analytics.findOne({ metadata: 'historical:test' });
    assert.ok(doc);
    assert.equal(doc.action, 'tap');
  });

  await test('AUTH invalid/expired/malformed cookies clear and keep public page public', async () => {
    for (const cookie of [
      'token=not-a-token',
      `token=${token('customer', { expired: true })}`,
      `token=${token('customer', { wrong: true })}`,
    ]) {
      const res = await http('/acme/standee', { cookie });
      assert.equal(res.status, 307);
      assert.equal(res.location, '/r/r_single');
      assert.match(res.setCookie ?? '', /token=;/);
    }
  });

  await test('AUTH valid customer/admin cookies and protected routes', async () => {
    const customer = await http('/admin', { cookie: `token=${token('customer')}` });
    assert.equal(customer.status, 307);
    assert.equal(customer.location, '/dashboard');

    const adminPublic = await http('/acme/standee', { cookie: `token=${token('admin')}` });
    assert.equal(adminPublic.status, 307);
    assert.equal(adminPublic.location, '/r/r_single');

    const adminInvalid = await http('/admin', { cookie: 'token=bad' });
    assert.equal(adminInvalid.status, 307);
    assert.equal(adminInvalid.location, '/login');

    const dashboardInvalid = await http('/dashboard', { cookie: 'token=bad' });
    assert.equal(dashboardInvalid.status, 307);
    assert.equal(dashboardInvalid.location, '/login');

    const apiInvalid = await http('/api/standee', { cookie: 'token=bad' });
    assert.equal(apiInvalid.status, 401);
  });

  await test('SEC encoded/reserved paths cannot bypass auth', async () => {
    const encoded = await http('/%61dmin/standee', { cookie: 'token=bad' });
    assert.equal(encoded.status, 307);
    assert.equal(encoded.location, '/login');
    const encoded2 = await http('/admin%2Fstandee', { cookie: 'token=bad' });
    assert.equal(encoded2.status, 307);
    assert.equal(encoded2.location, '/login');
  });

  await test('CACHE branded 307 is no-store, not permanent', async () => {
    const res = await http('/acme/standee');
    assert.equal(res.status, 307);
    assert.match(res.cacheControl ?? '', /no-store/);
    assert.notEqual(res.status, 301);
    assert.notEqual(res.status, 308);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ database: DB, results, passed: results.length - failures.length, failed: failures.length }, null, 2));
  await client.close();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`RUNTIME TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
