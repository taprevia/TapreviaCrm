/** Phase 2A-3C current-state smoke evidence (no implementation present). */
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { brandedStandeePanelQrUrl, permanentCardUrl, strictPermanentCardUrl } from '@/lib/admin-card-view';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const results: Array<{ id: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];
let client: MongoClient; let db: any; let analytics: any;

function validate() {
  if (URI !== 'mongodb://127.0.0.1:27036') throw new Error('BLOCKED — wrong URI');
  if (!/^taprevia_phase2a3c_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong DB');
  if (BASE !== 'http://127.0.0.1:3209') throw new Error('BLOCKED — wrong base');
}
async function test(id: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ id, status: 'PASS' }); console.log(`PASS ${id}`); }
  catch (e) { results.push({ id, status: 'FAIL', detail: e instanceof Error ? e.message : String(e) }); console.log(`FAIL ${id} — ${results.at(-1)!.detail}`); }
}
async function http(path: string) {
  const r = await fetch(`${BASE}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: r.status, location: r.headers.get('location'), body: await r.text() };
}
const count = (m: string) => analytics.countDocuments({ metadata: m });

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 }); await client.connect();
  db = client.db(DB); analytics = db.collection('analyticslogs');
  const origin = 'http://127.0.0.1:3209';
  const card = await db.collection('cards').findOne({ routeSlug: 'r_card' });
  const standee = await db.collection('standees').findOne({ routeSlug: 'r_standee' });
  assert.ok(card); assert.ok(standee);

  await test('Card UI QR builders still encode /r (not branded)', async () => {
    const c = { routeSlug: 'r_card', uid: 'u_card', publicSlug: 'acme/business-card', urlAlias: 'business-card', slug: 'business-card' };
    assert.equal(permanentCardUrl(c, origin), `${origin}/r/r_card`);
    assert.equal(strictPermanentCardUrl(c, origin), `${origin}/r/r_card`);
  });

  await test('Direct branded Card visit records no unified visit', async () => {
    const before = await analytics.countDocuments({});
    const res = await http('/acme/business-card');
    assert.equal(res.status, 200);
    assert.equal(await analytics.countDocuments({}), before);
  });

  await test('Card /r records one route tap', async () => {
    const before = await count('route:r_card');
    const res = await http('/r/r_card');
    assert.equal(res.status, 307);
    assert.equal(await count('route:r_card'), before + 1);
  });

  await test('Branded Standee panel helper is branded and /r records one tap', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee, origin, []), `${origin}/acme/standee`);
    const before = await count('route:r_standee');
    const branded = await http('/acme/standee');
    assert.equal(branded.status, 307);
    assert.equal(branded.location, '/r/r_standee');
    assert.equal(await count('route:r_standee'), before);
    const r = await http('/r/r_standee');
    assert.equal(r.status, 307);
    assert.equal(await count('route:r_standee'), before + 1);
  });

  await test('No visit/Total Visit analytics action exists', async () => {
    const visitRows = await analytics.countDocuments({ action: /visit/i });
    assert.equal(visitRows, 0);
    const actions = await analytics.distinct('action');
    console.log('  analytics actions:', actions.join(','));
    assert.ok(!actions.some((a: string) => /visit/i.test(a)));
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ passed: results.length - failures.length, failed: failures.length, results }, null, 2));
  await client.close();
  if (failures.length) process.exitCode = 1;
}
main().catch(async (e) => { console.error(e); try { await client?.close(); } catch {} process.exit(1); });
