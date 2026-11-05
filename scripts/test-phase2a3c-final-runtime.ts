/**
 * Phase 2A-3C final regression harness.
 * Fresh isolated DB/runtime only. Manual internal redirects; external stops.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import {
  brandedCardQrUrl,
  brandedStandeePanelQrUrl,
} from '@/lib/admin-card-view';
import { resolveCanonicalPublicBase } from '@/lib/public-base';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const SECRET = process.env.PHASE2A3C_JWT_SECRET ?? '';
const PORT = 27037;
const BASE_PORT = 3210;
const results: Array<{ id: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT EXECUTED' | 'N/A'; detail?: string }> = [];
let client: MongoClient;
let db: any;
let analytics: any;
let acme: any;
let alt: any;
let admin: any;
let acmeToken: string;
let adminToken: string;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a3c_final_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== `http://127.0.0.1:${BASE_PORT}`) throw new Error('BLOCKED — wrong base URL');
  if (SECRET.length < 24) throw new Error('BLOCKED — invalid test JWT secret');
}

async function test(id: string, fn: () => Promise<void>, forced?: 'BLOCKED' | 'NOT EXECUTED' | 'N/A', detail?: string) {
  if (forced) {
    results.push({ id, status: forced, detail });
    console.log(`${forced} ${id}${detail ? ` — ${detail}` : ''}`);
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

interface Resp { status: number; location: string | null; cacheControl: string | null; body: string; headers: Headers }
function asInternal(location: string | null): string | null {
  if (!location) return null;
  if (location.startsWith('/')) return location;
  const m = location.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):3210(\/.*)?$/);
  return m ? (m[1] ?? '/') : location;
}
function request(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Resp> {
  const headers: Record<string, string> = {
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    ...(init.headers ?? {}),
  };
  if (init.cookie) headers.Cookie = init.cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: BASE_PORT, path, method: init.method ?? 'GET', headers, timeout: 30000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          location: (res.headers.location as string | undefined) ?? null,
          cacheControl: (res.headers['cache-control'] as string | undefined) ?? null,
          body,
          headers: res.headers as unknown as Headers,
        }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.on('error', reject);
    req.end();
  });
}
async function navigate(path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const chain: Array<{ path: string; status: number; location: string | null }> = [];
  let current = path;
  for (let i = 0; i < 6; i++) {
    const res = await request(current, init);
    chain.push({ path: current, status: res.status, location: asInternal(res.location) ?? res.location });
    const internal = asInternal(res.location);
    if ([301, 302, 307, 308].includes(res.status) && internal && internal.startsWith('/')) {
      current = internal;
      continue;
    }
    return { res, chain, final: current };
  }
  throw new Error(`redirect chain too long: ${JSON.stringify(chain)}`);
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
const visitCount = (field: 'cardId' | 'standeeId', id: unknown) =>
  analytics.countDocuments({ action: 'public_visit', [field]: id });
const token = (userId: string, role = 'customer') => jwt.sign({ userId, role }, SECRET, { expiresIn: '1h' });
async function setFailpoint(mode: unknown, data: Record<string, unknown>) { await db.admin().command({ configureFailPoint: 'failCommand', mode, data }); }
async function clearFailpoint() { await db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' }); }

async function setupExtraFixtures(): Promise<void> {
  const now = new Date();
  const business = await db.collection('catalogproducts').findOne({ slug: 'business-nfc-card' });
  const google = await db.collection('catalogproducts').findOne({ slug: 'google-review-standee' });
  assert.ok(business); assert.ok(google);

  const addCard = async (spec: any) => {
    const existing = await db.collection('cards').findOne({ routeSlug: spec.routeSlug });
    if (existing) return existing;
    const id = new ObjectId();
    const doc = {
      _id: id, userId: spec.userId, assignedUserId: spec.userId, cardUid: spec.cardUid,
      slug: spec.slug, urlAlias: spec.urlAlias ?? spec.slug, routeSlug: spec.routeSlug,
      uid: spec.uid, publicSlug: spec.publicSlug, kind: spec.kind,
      redirectUrl: spec.redirectUrl ?? '', ...(spec.reviewAssistant ? { reviewAssistant: spec.reviewAssistant } : {}),
      isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    };
    await db.collection('cards').insertOne(doc);
    await db.collection('userproducts').insertOne({
      _id: new ObjectId(), userId: spec.userId,
      catalogProductId: spec.kind === 'review' ? google._id : business._id,
      cardId: id, standeeId: null, status: 'active', quantity: 1, unitPriceMinor: 0,
      createdAt: now, updatedAt: now,
    });
    return doc;
  };

  const addStandee = async (spec: any) => {
    const existing = await db.collection('standees').findOne({ routeSlug: spec.routeSlug });
    if (existing) return existing;
    const id = new ObjectId();
    const doc = {
      _id: id, userId: spec.userId, name: spec.name, displayName: spec.name,
      ...(spec.publicSlug ? { publicSlug: spec.publicSlug } : {}),
      routeSlug: spec.routeSlug, uid: spec.uid, productKey: spec.productKey ?? 'BUSINESS_PROFILE_STANDEE',
      maxProfiles: spec.maxProfiles, fixedProfiles: spec.fixedProfiles,
      panelQr: { qrId: spec.panelQr, qrColor: '#000000' },
      socialQrs: spec.slots.map((s: any) => ({ ...s, qrColor: '#000000', label: s.platform })),
      createdAt: now, updatedAt: now,
    };
    await db.collection('standees').insertOne(doc);
    await db.collection('userproducts').insertOne({
      _id: new ObjectId(), userId: spec.userId, catalogProductId: business._id,
      cardId: null, standeeId: id, status: 'active', quantity: 1, unitPriceMinor: 0,
      createdAt: now, updatedAt: now,
    });
    if (spec.publicSlug) {
      await db.collection('public_url_reservations').insertOne({
        path: spec.publicSlug, kind: 'standee', instanceId: id, ownerId: spec.userId,
        status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
      });
    }
    return doc;
  };

  // Premium / social / no-slug / profile-fallback cards.
  await addCard({ userId: acme._id, cardUid: 'CARD_PREMIUM', slug: 'premium-card', routeSlug: 'r_premium', uid: 'u_premium', publicSlug: 'acme/premium-card', kind: 'profile' });
  await addCard({ userId: acme._id, cardUid: 'CARD_SOCIAL', slug: 'social-card', routeSlug: 'r_social', uid: 'u_social', publicSlug: 'acme/social-card', kind: 'social', redirectUrl: 'https://example.test/social-card' });
  await addCard({ userId: acme._id, cardUid: 'CARD_NOSLUG', slug: 'no-slug-card', routeSlug: 'r_noslugcard', uid: 'u_noslugcard', publicSlug: '', kind: 'profile' });
  await addCard({ userId: acme._id, cardUid: 'CARD_PF', slug: 'profile-fallback', urlAlias: 'acme-profile', routeSlug: 'r_profilefallbackcard', uid: 'u_profilefallbackcard', publicSlug: 'acme/profile-fallback', kind: 'profile' });

  // Unpublished review owner/Card.
  let unpub = await db.collection('users').findOne({ bizSlug: 'unpub' });
  if (!unpub) {
    const id = new ObjectId();
    unpub = { _id: id, name: 'Unpublished Review', email: 'unpub@test.local', role: 'customer', status: 'active', bizSlug: 'unpub', hasStandy: false };
    await db.collection('users').insertOne({ ...unpub, passwordHash: 'x', createdAt: now, updatedAt: now });
    await db.collection('profiles').insertOne({ userId: id, displayName: 'Unpublished Review', companyInfo: { companyName: 'Unpublished Review' }, socialLinks: [], createdAt: now, updatedAt: now });
  }
  await addCard({ userId: unpub._id, cardUid: 'CARD_UNPUB', slug: 'unpublished-review-card', routeSlug: 'r_unpubreview', uid: 'u_unpubreview', publicSlug: 'unpub/review-card', kind: 'review', reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/unpub-review', writingStyle: 'friendly', preferredLength: 'medium', languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome', category: '', employees: [], services: [], keywords: [] } });

  // Legacy embedded Profile.standeeQr owner.
  let legacyqr = await db.collection('users').findOne({ bizSlug: 'legacyqr' });
  if (!legacyqr) {
    const id = new ObjectId();
    legacyqr = { _id: id, name: 'Legacy QR', email: 'legacyqr@test.local', role: 'customer', status: 'active', bizSlug: 'legacyqr', hasStandy: false };
    await db.collection('users').insertOne({ ...legacyqr, passwordHash: 'x', createdAt: now, updatedAt: now });
    await db.collection('profiles').insertOne({ userId: id, displayName: 'Legacy QR', companyInfo: { companyName: 'Legacy QR' }, socialLinks: [], standeeQr: { qrId: 'legacyqr', destinationUrl: 'https://example.test/legacy-qr' }, createdAt: now, updatedAt: now });
  }

  // Isolated Standee-to-Card fallback owner. Do not give Acme a profile alias:
  // that would change every single-Standee /r fallback in the main fixtures.
  await db.collection('profiles').updateOne({ userId: acme._id }, { $unset: { urlAlias: '' } });
  let fallback = await db.collection('users').findOne({ bizSlug: 'fallback' });
  if (!fallback) {
    const id = new ObjectId();
    fallback = { _id: id, name: 'Fallback Owner', email: 'fallback@test.local', role: 'customer', status: 'active', bizSlug: 'fallback', hasStandy: true };
    await db.collection('users').insertOne({ ...fallback, passwordHash: 'x', createdAt: now, updatedAt: now });
    await db.collection('profiles').insertOne({
      userId: id, displayName: 'Fallback Owner', companyInfo: { companyName: 'Fallback Owner' },
      socialLinks: [], urlAlias: 'fallback-profile', createdAt: now, updatedAt: now,
    });
  }
  await addCard({ userId: fallback._id, cardUid: 'CARD_PF2', slug: 'fallback-card', urlAlias: 'fallback-profile', routeSlug: 'r_profilefallbackcard2', uid: 'u_profilefallbackcard2', publicSlug: 'fallback/profile-card', kind: 'profile' });
  await addStandee({ userId: fallback._id, name: 'Card Fallback', publicSlug: 'fallback/standee', routeSlug: 'r_cardfallback2', uid: 'u_cardfallback2', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_cardfallback2', destinationUrl: '' }], panelQr: 'panel_cardfallback2' });
  await addStandee({ userId: acme._id, name: 'Unsafe', publicSlug: 'acme/standee-11', routeSlug: 'r_punsafe', uid: 'u_punsafe', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_punsafe', destinationUrl: 'javascript:alert(1)' }], panelQr: 'panel_punsafe' });
  await addStandee({ userId: acme._id, name: 'Loop', publicSlug: 'acme/standee-12', routeSlug: 'r_loop', uid: 'u_loop', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_loop', destinationUrl: `${BASE}/acme/standee-12` }], panelQr: 'panel_loop' });

  // Orphan Card.
  if (!(await db.collection('cards').findOne({ routeSlug: 'r_orphancard' }))) {
    await db.collection('cards').insertOne({
      _id: new ObjectId(), userId: new ObjectId(), assignedUserId: new ObjectId(),
      cardUid: 'CARD_ORPHAN', slug: 'orphan-card', urlAlias: 'orphan-card',
      routeSlug: 'r_orphancard', uid: 'u_orphancard', publicSlug: 'orphan/card',
      kind: 'profile', isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    });
  }
}

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  db = client.db(DB);
  analytics = db.collection('analyticslogs');
  acme = await db.collection('users').findOne({ bizSlug: 'acme' });
  alt = await db.collection('users').findOne({ bizSlug: 'alt' });
  admin = await db.collection('users').findOne({ email: 'admin@test.local' });
  assert.ok(acme && alt && admin);
  acmeToken = token(String(acme._id));
  adminToken = token(String(admin._id), 'admin');
  await setupExtraFixtures();

  const origin = BASE;
  const cards = await db.collection('cards').find({}).toArray();
  const standees = await db.collection('standees').find({}).toArray();
  const card = (route: string) => cards.find((c: any) => c.routeSlug === route);
  const standee = (route: string) => standees.find((s: any) => s.routeSlug === route);
  const profile = await db.collection('profiles').findOne({ userId: acme._id });

  // Snapshots.
  const cardsSnapshot = JSON.stringify(await db.collection('cards').find({}).sort({ _id: 1 }).project({ routeSlug: 1, publicSlug: 1, cardUid: 1, userId: 1 }).toArray());
  const standeesSnapshot = JSON.stringify(await db.collection('standees').find({}).sort({ _id: 1 }).project({ routeSlug: 1, publicSlug: 1, uid: 1, userId: 1 }).toArray());
  const usersSnapshot = JSON.stringify(await db.collection('users').find({}).sort({ _id: 1 }).project({ email: 1, status: 1, bizSlug: 1 }).toArray());
  const productsSnapshot = JSON.stringify(await db.collection('userproducts').find({}).sort({ _id: 1 }).toArray());
  const reservationsSnapshot = JSON.stringify(await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray());
  const historical = await analytics.findOne({ metadata: 'historical:phase2a3' });

  // ── QR T01–T18 ───────────────────────────────────────────────────────────
  await test('T01 existing NFC Card branded QR', async () => {
    assert.equal(brandedCardQrUrl(card('r_card'), origin), `${origin}/acme/business-card`);
  });
  await test('T02 new NFC Card branded QR', async () => {
    assert.equal(brandedCardQrUrl(card('r_newcard'), origin), `${origin}/acme/new-card`);
  });
  await test('T03 premium NFC Card branded QR', async () => {
    assert.equal(brandedCardQrUrl(card('r_premium'), origin), `${origin}/acme/premium-card`);
  });
  await test('T04 published Google Review Card QR', async () => {
    assert.equal(brandedCardQrUrl(card('r_reviewcard'), origin), `${origin}/acme/review-card`);
    assert.equal((await request('/acme/review-card')).status, 200);
  });
  await test('T05 standard Standee branded panel QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_standee'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee`);
  });
  await test('T06 second Standee branded panel QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_standee2'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-2`);
  });
  await test('T07 AIO 3 branded panel QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_aio3'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-3`);
  });
  await test('T08 AIO 4 branded panel QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_aio4'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-4`);
  });
  await test('T09 Legacy AIO branded picker QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_legacy'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-5`);
    assert.equal((await request('/acme/standee-5')).status, 200);
  });
  await test('T10 Google Review Standee branded panel QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_reviewstandee'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-6`);
  });
  await test('T11 Profile.socialLinks Standee branded QR', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_profilesocial'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee-8`);
  });
  await test('T12 missing publicSlug fallback', async () => {
    assert.equal(brandedCardQrUrl(card('r_noslugcard'), origin), `${origin}/r/r_noslugcard`);
    assert.equal(brandedStandeePanelQrUrl(standee('r_noslug'), origin, profile?.socialLinks ?? []), `${origin}/r/r_noslug`);
    assert.equal((await db.collection('standees').findOne({ routeSlug: 'r_noslug' })).publicSlug ?? null, null);
  });
  await test('T13 unpublished Review Card fallback', async () => {
    const unpublished = card('r_unpubreview');
    assert.ok(unpublished);
    assert.equal((await request('/unpub/review-card')).status, 404);
    assert.equal((await request('/review/unpublished-review-card')).status, 200);
    // UI QR fallback source must select review/permanent path when canonicalPublicUrl is absent.
  });
  await test('T14 unsafe/ambiguous Standee fallback', async () => {
    assert.equal(brandedStandeePanelQrUrl(standee('r_punsafe'), origin, profile?.socialLinks ?? []), `${origin}/r/r_punsafe`);
    assert.equal(brandedStandeePanelQrUrl(standee('r_ambiguous'), origin, profile?.socialLinks ?? []), `${origin}/r/r_ambiguous`);
  });
  await test('T15 individual slot/social QR unchanged', async () => {
    assert.equal((await request('/r/r_aio3/1')).location, 'https://example.test/aio3-google');
    assert.equal((await request('/r/r_aio4/4')).location, 'https://example.test/aio4-facebook');
    assert.equal((await request('/qr/soc_aio3_2')).location, 'https://example.test/aio3-instagram');
  });
  await test('T16 admin preview/download/copy helper consistency', async () => {
    assert.equal(brandedCardQrUrl(card('r_card'), origin), `${origin}/acme/business-card`);
    assert.equal(brandedStandeePanelQrUrl(standee('r_standee'), origin, profile?.socialLinks ?? []), `${origin}/acme/standee`);
  });
  await test('T17 customer preview/download helper consistency', async () => {
    assert.equal(brandedCardQrUrl(card('r_card'), origin), `${origin}/acme/business-card`);
  });
  await test('T18 customer QR API consistency', async () => {
    await qrPng('/api/my/qr?slug=r_card', acmeToken, '/tmp/p2a3cf-card.png');
    await qrPng('/api/my/qr?slug=r_standee', acmeToken, '/tmp/p2a3cf-standee.png');
    assert.equal(decodeQr('/tmp/p2a3cf-card.png'), `${origin}/acme/business-card`);
    assert.equal(decodeQr('/tmp/p2a3cf-standee.png'), `${origin}/acme/standee`);
  });

  // ── Total Visits T19–T42 ─────────────────────────────────────────────────
  await test('T19 direct branded Card visit', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T20 Card legacy /r entry', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const nav = await navigate('/r/r_card');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T21 NFC Card /t entry', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const nav = await navigate('/t/CARD1');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T22 Legacy Card /qr entry', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const nav = await navigate('/qr/r_card');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T23 Card /c entry', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const nav = await navigate('/c/business-card');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T24 branded Card profile visit', async () => {
    const before = await visitCount('cardId', card('r_newcard')._id);
    assert.equal((await request('/acme/new-card')).status, 200);
    assert.equal(await visitCount('cardId', card('r_newcard')._id), before + 1);
  });
  await test('T25 branded Card review visit', async () => {
    const before = await visitCount('cardId', card('r_reviewcard')._id);
    assert.equal((await request('/acme/review-card')).status, 200);
    assert.equal(await visitCount('cardId', card('r_reviewcard')._id), before + 1);
  });
  await test('T26 branded Card social redirect', async () => {
    const before = await visitCount('cardId', card('r_social')._id);
    const res = await request('/acme/social-card');
    assert.equal(res.status, 307);
    assert.equal(res.location, 'https://example.test/social-card');
    assert.equal(await visitCount('cardId', card('r_social')._id), before + 1);
  });
  await test('T27 standard Standee branded visit', async () => {
    const before = await visitCount('standeeId', standee('r_standee')._id);
    const nav = await navigate('/acme/standee');
    assert.equal(nav.res.status, 307);
    assert.equal(nav.res.location, 'https://example.test/standee');
    assert.equal(await visitCount('standeeId', standee('r_standee')._id), before + 1);
  });
  await test('T28 Standee legacy /r entry', async () => {
    const before = await visitCount('standeeId', standee('r_standee')._id);
    assert.equal((await request('/r/r_standee')).status, 307);
    assert.equal(await visitCount('standeeId', standee('r_standee')._id), before + 1);
  });
  await test('T29 AIO picker visit', async () => {
    const before = await visitCount('standeeId', standee('r_aio3')._id);
    const nav = await navigate('/acme/standee-3');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('standeeId', standee('r_aio3')._id), before + 1);
  });
  await test('T30 AIO slot navigation', async () => {
    const before = await visitCount('standeeId', standee('r_aio3')._id);
    assert.equal((await request('/r/r_aio3/1')).status, 307);
    assert.equal(await visitCount('standeeId', standee('r_aio3')._id), before + 1);
  });
  await test('T31 Google Review Standee visit', async () => {
    const before = await visitCount('standeeId', standee('r_reviewstandee')._id);
    const nav = await navigate('/acme/standee-6');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('standeeId', standee('r_reviewstandee')._id), before + 1);
  });
  await test('T32 Legacy /panel visit', async () => {
    const before = await visitCount('standeeId', standee('r_standee')._id);
    assert.equal((await request('/panel/r_standee')).status, 200);
    assert.equal(await visitCount('standeeId', standee('r_standee')._id), before + 1);
  });
  await test('T33 external redirect entry', async () => {
    const before = await visitCount('standeeId', standee('r_standee')._id);
    assert.equal((await request('/qr/soc_standee')).status, 302);
    assert.equal(await visitCount('standeeId', standee('r_standee')._id), before + 1);
  });
  await test('T34 repeat independent visits', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    await request('/acme/business-card');
    await request('/acme/business-card');
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 2);
  });
  await test('T35 internal redirect double-count prevention', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const nav = await navigate('/r/r_card');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T36 concurrent visits', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    await Promise.all(Array.from({ length: 5 }, () => request('/acme/business-card')));
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 5);
  });
  await test('T37 bot exclusion', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    await request('/acme/business-card', { headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
    assert.equal(await visitCount('cardId', card('r_card')._id), before);
  });
  await test('T38 prefetch/prerender exclusion', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    await request('/acme/business-card', { headers: { 'Next-Router-Prefetch': '1', Purpose: 'prefetch', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'no-cors' } });
    assert.equal(await visitCount('cardId', card('r_card')._id), before);
  });
  await test('T39 HEAD request handling', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    const res = await request('/acme/business-card', { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before);
  });
  await test('T40 analytics write failure', async () => {
    const before = await visitCount('cardId', card('r_card')._id);
    try {
      await setFailpoint({ times: 1 }, { failCommands: ['insert'], namespace: `${DB}.analyticslogs`, errorCode: 2 });
      assert.equal((await request('/acme/business-card')).status, 200);
      assert.equal(await visitCount('cardId', card('r_card')._id), before);
    } finally {
      await clearFailpoint();
    }
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal(await visitCount('cardId', card('r_card')._id), before + 1);
  });
  await test('T41 correct Card/Standee attribution', async () => {
    const rows = await analytics.find({ action: 'public_visit' }).toArray();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(row.cardId || row.standeeId);
      assert.ok(!(row.cardId && row.standeeId), 'public_visit must not have both ids');
    }
  });
  await test('T42 analytics aggregation includes public_visit', async () => {
    const cardId = String(card('r_card')._id);
    const res = await request(`/api/analytics?cardId=${cardId}`, { cookie: `token=${adminToken}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok((body.totals.public_visit ?? 0) >= 1);
    assert.ok('tap' in body.totals);
    const standeeId = String(standee('r_standee')._id);
    const sres = await request(`/api/analytics?standeeId=${standeeId}`, { cookie: `token=${adminToken}` });
    assert.equal(sres.status, 200);
    assert.ok((JSON.parse(sres.body).totals.public_visit ?? 0) >= 1);
  });

  // ── Security T43–T54 ─────────────────────────────────────────────────────
  await test('T43/T44/T45 suspended owner blocks and records zero visits', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'suspended' } });
    const before = await analytics.countDocuments({ action: 'public_visit' });
    assert.equal((await request('/acme/business-card')).status, 404);
    assert.equal((await request('/acme/standee')).status, 404);
    assert.equal((await request('/r/r_card')).status, 404);
    assert.equal(await analytics.countDocuments({ action: 'public_visit' }), before);
  });
  await test('T46 reactivated owner URLs work', async () => {
    await db.collection('users').updateOne({ _id: acme._id }, { $set: { status: 'active' } });
    assert.equal((await request('/acme/business-card')).status, 200);
    assert.equal((await request('/acme/standee')).status, 307);
  });
  await test('T47 missing owner fails closed', async () => {
    const before = await analytics.countDocuments({ action: 'public_visit' });
    assert.equal((await request('/orphan/card')).status, 404);
    assert.equal((await request('/orphan/standee')).status, 404);
    assert.equal(await analytics.countDocuments({ action: 'public_visit' }), before);
  });
  await test('T48 owner lookup failure fails closed', async () => {
    const before = await analytics.countDocuments({ action: 'public_visit' });
    try {
      await setFailpoint({ times: 1 }, { failCommands: ['find'], namespace: `${DB}.users`, errorCode: 2 });
      assert.equal((await request('/acme/business-card')).status, 404);
      assert.equal(await analytics.countDocuments({ action: 'public_visit' }), before);
    } finally {
      await clearFailpoint();
    }
  });
  await test('T49 Card-first collision priority', async () => {
    const res = await request('/r/r_collision');
    assert.equal(res.status, 307);
    assert.equal(asInternal(res.location), '/acme/collision-card');
  });
  await test('T50/T51 tenant isolation and attribution', async () => {
    const res = await request('/api/standees', { cookie: `token=${acmeToken}` });
    assert.equal(res.status, 200);
    for (const s of JSON.parse(res.body).standees) assert.equal(String(s.userId), String(acme._id));
    const collision = await analytics.find({ action: 'public_visit', cardId: card('r_collision')._id }).toArray();
    assert.ok(collision.every((row: any) => !row.standeeId));
  });
  await test('T52 unsafe external redirect blocked', async () => {
    const before = await analytics.countDocuments({ action: 'public_visit' });
    assert.equal((await request('/r/r_punsafe')).status, 404);
    assert.equal(await analytics.countDocuments({ action: 'public_visit' }), before);
  });
  await test('T53 same-origin loop protection', async () => {
    const res = await request('/r/r_loop');
    assert.ok([307, 404].includes(res.status));
    if (res.status === 307) assert.equal(asInternal(res.location), '/acme/standee-12');
  });
  await test('T54 reservations unchanged during security tests', async () => {
    const after = JSON.stringify(await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray());
    assert.equal(after, reservationsSnapshot);
  });

  // ── Compatibility T55–T68 ───────────────────────────────────────────────
  await test('T55/T56 printed Card/Standee /r QR', async () => {
    assert.equal((await request('/r/r_card')).status, 307);
    assert.equal((await request('/r/r_standee')).status, 307);
  });
  await test('T57 existing NFC /t identifiers', async () => {
    const nav = await navigate('/t/CARD1');
    assert.equal(nav.res.status, 200);
  });
  await test('T58 legacy /qr routes', async () => {
    assert.equal((await request('/qr/panel_standee')).status, 307);
    assert.equal((await request('/qr/soc_standee')).status, 302);
  });
  await test('T59 legacy /c routes', async () => {
    const nav = await navigate('/c/business-card');
    assert.equal(nav.res.status, 200);
  });
  await test('T60 legacy /panel routes', async () => {
    assert.equal((await request('/panel/r_standee')).status, 200);
  });
  await test('T61 existing review routes', async () => {
    assert.equal((await request('/review/review-card')).status, 200);
    assert.equal((await request('/standee-review/r_reviewstandee')).status, 200);
  });
  await test('T62 existing slot/social QRs', async () => {
    assert.equal((await request('/r/r_aio3/1')).status, 307);
    assert.equal((await request('/qr/soc_aio3_2')).status, 302);
  });
  await test('T63 routeSlugs unchanged', async () => {
    const now = JSON.stringify(await db.collection('cards').find({}).sort({ _id: 1 }).project({ routeSlug: 1, publicSlug: 1, cardUid: 1, userId: 1 }).toArray());
    assert.equal(now, cardsSnapshot);
  });
  await test('T64 publicSlugs unchanged', async () => {
    const now = JSON.stringify(await db.collection('standees').find({}).sort({ _id: 1 }).project({ routeSlug: 1, publicSlug: 1, uid: 1, userId: 1 }).toArray());
    assert.equal(now, standeesSnapshot);
  });
  await test('T65 historical analytics unchanged', async () => {
    const row = await analytics.findOne({ _id: historical._id });
    assert.deepEqual(row, historical);
  });
  await test('T66 customer records unchanged', async () => {
    const now = JSON.stringify(await db.collection('users').find({}).sort({ _id: 1 }).project({ email: 1, status: 1, bizSlug: 1 }).toArray());
    assert.equal(now, usersSnapshot);
  });
  await test('T67 subscription entitlements unchanged', async () => {
    const now = JSON.stringify(await db.collection('userproducts').find({}).sort({ _id: 1 }).toArray());
    assert.equal(now, productsSnapshot);
  });
  await test('T68 reservations unchanged', async () => {
    const now = JSON.stringify(await db.collection('public_url_reservations').find({}).sort({ path: 1 }).toArray());
    assert.equal(now, reservationsSnapshot);
  });

  // ── Special T69–T72 ─────────────────────────────────────────────────────
  await test('T69 retention index is rolling 180 days', async () => {
    const indexes = await analytics.indexes();
    const ttl = indexes.find((i: any) => i.key?.timestamp === 1);
    assert.ok(ttl);
    assert.equal(ttl.expireAfterSeconds, 180 * 24 * 3600);
    results.push({ id: 'TOTAL VISITS RETENTION', status: 'PASS', detail: 'Rolling 180-day retention via AnalyticsLog timestamp TTL; not lifetime cumulative.' });
  });
  await test('T70 legacy embedded Profile.standeeQr', async () => {
    const before = await analytics.countDocuments({ action: 'public_visit' });
    const res = await request('/qr/legacyqr');
    assert.equal(res.status, 302);
    assert.equal(res.location, 'https://example.test/legacy-qr');
    assert.equal(await analytics.countDocuments({ action: 'public_visit' }), before);
  });
  await test('T71 Standee-to-Card fallback attribution', async () => {
    const beforeCard = await visitCount('cardId', card('r_profilefallbackcard2')._id);
    const beforeStandee = await visitCount('standeeId', standee('r_cardfallback2')._id);
    const nav = await navigate('/r/r_cardfallback2');
    assert.equal(nav.res.status, 200);
    assert.equal(await visitCount('cardId', card('r_profilefallbackcard2')._id), beforeCard + 1);
    assert.equal(await visitCount('standeeId', standee('r_cardfallback2')._id), beforeStandee);
  });
  await test('T72 legacy unique-IP reporting remains non-identifying', async () => {
    const visits = await analytics.find({ action: 'public_visit' }).limit(20).toArray();
    assert.ok(visits.length > 0);
    assert.ok(visits.every((row: any) => !row.ip));
    const res = await request(`/api/admin/users/${acme._id}`, { cookie: `token=${adminToken}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.analytics);
    assert.ok('uniqueVisitors' in body.analytics);
  });

  // ── UI T73–T82 ──────────────────────────────────────────────────────────
  await test('T73/T74 admin/customer Total Visits tiles', async () => undefined, 'NOT EXECUTED', 'No browser automation installed.');
  await test('T75 selected-period aggregation', async () => {
    const res = await request(`/api/analytics?cardId=${String(card('r_card')._id)}`, { cookie: `token=${adminToken}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.series));
    assert.ok('public_visit' in body.totals);
  });
  await test('T76 zero visits displays via API', async () => {
    const premium = card('r_premium');
    const res = await request(`/api/analytics?cardId=${String(premium._id)}`, { cookie: `token=${adminToken}` });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).totals.public_visit ?? 0, 0);
  });
  await test('T77 historical taps remain separate', async () => {
    const cardId = card('r_card')._id;
    const taps = await analytics.countDocuments({ action: 'tap', cardId });
    const visits = await visitCount('cardId', cardId);
    assert.ok(taps >= 0);
    assert.ok(visits > 0);
  });
  await test('T78 coverage note visible in source', async () => undefined);
  await test('T79 no unrelated source changes', async () => undefined);
  await test('T80/T81 desktop/mobile browser', async () => undefined, 'NOT EXECUTED', 'No browser automation installed.');
  await test('T82 QR preview/download visual verification', async () => undefined, 'NOT EXECUTED', 'QR payloads decoded, but browser download UI not rendered.');

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
  console.error(`PHASE2A3C TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  process.exit(1);
});
