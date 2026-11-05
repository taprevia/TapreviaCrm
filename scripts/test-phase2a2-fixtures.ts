/**
 * Phase 2A-2 synthetic runtime fixtures.
 *
 * Refuses to run unless the target is the dedicated loopback test mongod and a
 * brand-new test-owned database. Never uses application models or env files.
 */
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const PID = process.env.PHASE2A2_TEST_PID ?? '';
const STORAGE = process.env.PHASE2A2_TEST_STORAGE ?? '';
const PORT = 27031;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_isolated_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  const cmd = execFileSync('ps', ['-p', PID, '-o', 'command='], { encoding: 'utf8' });
  if (!cmd.includes('mongod') || !cmd.includes(`--dbpath ${STORAGE}/db`) || !cmd.includes(`--port ${PORT}`) || !cmd.includes('--bind_ip 127.0.0.1')) {
    throw new Error('BLOCKED — PID is not the dedicated test mongod');
  }
}

async function main(): Promise<void> {
  validate();
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const db = client.db(DB);
  const names = (await client.db().admin().listDatabases()).databases.map((d) => d.name);
  if (names.includes(DB)) throw new Error(`BLOCKED — test DB already exists: ${DB}`);

  const now = new Date();
  const acmeUserId = new ObjectId();
  const reviewUserId = new ObjectId();
  const review2UserId = new ObjectId();
  const ids = {
    acme: acmeUserId,
    review: reviewUserId,
    review2: review2UserId,
    reviewCatalog: new ObjectId(),
    reviewAssignment: new ObjectId(),
  };

  await db.collection('users').insertMany([
    { _id: acmeUserId, name: 'Acme', email: 'acme@test.local', passwordHash: 'x', role: 'customer', status: 'active', bizSlug: 'acme', hasStandy: true, createdAt: now, updatedAt: now },
    { _id: reviewUserId, name: 'Review Biz', email: 'review@test.local', passwordHash: 'x', role: 'customer', status: 'active', bizSlug: 'reviewbiz', hasStandy: true, createdAt: now, updatedAt: now },
    { _id: review2UserId, name: 'Review Biz Two', email: 'review2@test.local', passwordHash: 'x', role: 'customer', status: 'active', bizSlug: 'reviewbiz2', hasStandy: true, createdAt: now, updatedAt: now },
  ]);

  await db.collection('profiles').insertMany([
    { userId: acmeUserId, displayName: 'Acme', companyInfo: { companyName: 'Acme' }, socialLinks: [], createdAt: now, updatedAt: now },
    { userId: reviewUserId, displayName: 'Review Biz', companyInfo: { companyName: 'Review Biz' }, socialLinks: [], createdAt: now, updatedAt: now },
    { userId: review2UserId, displayName: 'Review Biz Two', companyInfo: { companyName: 'Review Biz Two' }, socialLinks: [], createdAt: now, updatedAt: now },
  ]);

  const makeStandee = (
    userId: unknown,
    name: string,
    publicSlug: string,
    routeSlug: string | null,
    uid: string | null,
    maxProfiles: number | null,
    fixedProfiles: string[] | null,
    slots: Array<{ platform: string; qrId: string; destinationUrl: string }>,
    panelQrId: string
  ) => ({
    _id: new ObjectId(),
    userId,
    name,
    displayName: name,
    publicSlug,
    ...(routeSlug ? { routeSlug } : {}),
    ...(uid ? { uid } : {}),
    productKey: fixedProfiles?.[0] === 'google_review' ? 'GOOGLE_REVIEW_STANDEE' : 'BUSINESS_PROFILE_STANDEE',
    ...(maxProfiles !== null ? { maxProfiles } : {}),
    ...(fixedProfiles ? { fixedProfiles } : {}),
    panelQr: { qrId: panelQrId, qrColor: '#000000' },
    socialQrs: slots.map((slot) => ({ ...slot, qrColor: '#000000', label: slot.platform })),
    createdAt: now,
    updatedAt: now,
  });

  const standees = [
    makeStandee(acmeUserId, 'Single', 'acme/standee', 'r_single', 'u_single', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_single', destinationUrl: 'https://example.test/single' }], 'panel_single'),
    makeStandee(acmeUserId, 'Single Two', 'acme/standee-2', 'r_single2', 'u_single2', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_single2', destinationUrl: 'https://example.test/single2' }], 'panel_single2'),
    makeStandee(acmeUserId, 'Unconfigured', 'acme/standee-3', 'r_unconfig', 'u_unconfig', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_unconfig', destinationUrl: '' }], 'panel_unconfig'),
    makeStandee(acmeUserId, 'AIO 3', 'acme/standee-4', 'r_aio3', 'u_aio3', 3, ['google_review', 'instagram', 'facebook'], [
      { platform: 'google_review', qrId: 'soc_aio3_1', destinationUrl: 'https://example.test/aio3-google' },
      { platform: 'instagram', qrId: 'soc_aio3_2', destinationUrl: 'https://example.test/aio3-instagram' },
      { platform: 'facebook', qrId: 'soc_aio3_3', destinationUrl: '' },
    ], 'panel_aio3'),
    makeStandee(acmeUserId, 'AIO 4', 'acme/standee-5', 'r_aio4', 'u_aio4', 4, ['google_review', 'instagram', 'whatsapp', 'facebook'], [
      { platform: 'google_review', qrId: 'soc_aio4_1', destinationUrl: 'https://example.test/aio4-google' },
      { platform: 'instagram', qrId: 'soc_aio4_2', destinationUrl: 'https://example.test/aio4-instagram' },
      { platform: 'whatsapp', qrId: 'soc_aio4_3', destinationUrl: 'https://example.test/aio4-whatsapp' },
      { platform: 'facebook', qrId: 'soc_aio4_4', destinationUrl: '' },
    ], 'panel_aio4'),
    makeStandee(acmeUserId, 'Legacy AIO', 'acme/standee-6', 'r_legacy', 'u_legacy', null, null, [
      { platform: 'google_review', qrId: 'soc_legacy_1', destinationUrl: 'https://example.test/legacy-google' },
      { platform: 'instagram', qrId: 'soc_legacy_2', destinationUrl: 'https://example.test/legacy-instagram' },
      { platform: 'facebook', qrId: 'soc_legacy_3', destinationUrl: 'https://example.test/legacy-facebook' },
    ], 'panel_legacy'),
    makeStandee(acmeUserId, 'No Route', 'acme/standee-7', null, null, 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_noroute', destinationUrl: 'https://example.test/noroute' }], 'panel_noroute'),
    makeStandee(acmeUserId, 'UID Only', 'acme/standee-8', null, 'u_uid', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_uid', destinationUrl: 'https://example.test/uid' }], 'panel_uid'),
    makeStandee(acmeUserId, 'Card Collision', 'acme/standee-9', 'r_collide', 'u_collide', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_collide', destinationUrl: 'https://example.test/collide' }], 'panel_collide'),
    makeStandee(acmeUserId, 'Self Loop', 'acme/standee-10', 'r_self', 'u_self', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_self', destinationUrl: `http://127.0.0.1:3200/acme/standee-10` }], 'panel_self'),
    makeStandee(acmeUserId, 'Cycle A', 'acme/standee-11', 'r_cycle_a', 'u_cycle_a', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_cycle_a', destinationUrl: `http://127.0.0.1:3200/acme/standee-12` }], 'panel_cycle_a'),
    makeStandee(acmeUserId, 'Cycle B', 'acme/standee-12', 'r_cycle_b', 'u_cycle_b', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_cycle_b', destinationUrl: `http://127.0.0.1:3200/acme/standee-11` }], 'panel_cycle_b'),
    makeStandee(acmeUserId, 'Unsafe', 'acme/standee-13', 'r_unsafe', 'u_unsafe', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_unsafe', destinationUrl: 'javascript:alert(1)' }], 'panel_unsafe'),
    makeStandee(acmeUserId, 'Credentials', 'acme/standee-14', 'r_cred', 'u_cred', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_cred', destinationUrl: 'https://user:pass@example.test/x' }], 'panel_cred'),
    makeStandee(acmeUserId, 'Relative', 'acme/standee-15', 'r_rel', 'u_rel', 1, ['whatsapp'], [{ platform: 'whatsapp', qrId: 'soc_rel', destinationUrl: '/r/other' }], 'panel_rel'),
    makeStandee(reviewUserId, 'Review Eligible', 'reviewbiz/standee', 'r_review', 'u_review', 1, ['google_review'], [{ platform: 'google_review', qrId: 'soc_review', destinationUrl: 'https://example.test/google-review' }], 'panel_review'),
    makeStandee(review2UserId, 'Review Ineligible', 'reviewbiz2/standee', 'r_review2', 'u_review2', 1, ['google_review'], [{ platform: 'google_review', qrId: 'soc_review2', destinationUrl: 'https://example.test/google-review2' }], 'panel_review2'),
  ];
  await db.collection('standees').insertMany(standees);
  const bySlug = new Map(standees.map((s) => [s.publicSlug, s]));

  const cards = [
    {
      _id: new ObjectId(), userId: acmeUserId, assignedUserId: acmeUserId,
      cardUid: 'CARD_SOCIAL', slug: 'acme-card', urlAlias: 'acme-card', routeSlug: 'r_card', uid: 'u_card',
      publicSlug: 'acme/business-card', kind: 'social', redirectUrl: 'https://example.test/card',
      isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    },
    {
      _id: new ObjectId(), userId: acmeUserId, assignedUserId: acmeUserId,
      cardUid: 'CARD_COLLIDE', slug: 'collision-card', urlAlias: 'collision-card', routeSlug: 'r_collide', uid: 'u_collide',
      publicSlug: 'acme/collision-card', kind: 'profile', redirectUrl: '',
      isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    },
  ];
  await db.collection('cards').insertMany(cards);

  await db.collection('catalogproducts').insertOne({
    _id: ids.reviewCatalog, name: 'Google Review Standee', slug: 'google-review-standee',
    kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1,
    createdAt: now, updatedAt: now,
  });
  await db.collection('userproducts').insertOne({
    _id: ids.reviewAssignment, userId: reviewUserId, catalogProductId: ids.reviewCatalog,
    standeeId: bySlug.get('reviewbiz/standee')!._id, status: 'active', quantity: 1,
    unitPriceMinor: 0, createdAt: now, updatedAt: now,
  });
  await db.collection('reviewsettings').insertOne({
    businessId: reviewUserId, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: '', welcomeMessage: '', businessName: 'Review Biz' },
    content: {
      category: '', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  });

  await db.collection('public_url_reservations').createIndex({ path: 1 }, { unique: true, name: 'path_1' });
  await db.collection('public_url_reservations').insertOne({
    path: 'acme/standee', kind: 'standee', instanceId: bySlug.get('acme/standee')!._id,
    ownerId: acmeUserId, status: 'active', source: 'backfill', issuedAt: now,
  });
  await db.collection<{ _id: string; seq: number }>('counters').insertOne({ _id: 'public-url-reservation:ready', seq: 1 });

  await db.collection('analyticslogs').insertOne({
    _id: new ObjectId(), cardId: null, action: 'tap', metadata: 'historical:test',
    ip: '', userAgent: '', timestamp: now, createdAt: now, updatedAt: now,
  });

  console.log(JSON.stringify({
    database: DB,
    userIds: { acme: String(acmeUserId), review: String(reviewUserId), review2: String(review2UserId) },
    publicSlugs: standees.map((s) => s.publicSlug),
    cardSlugs: cards.map((c) => c.publicSlug),
  }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
