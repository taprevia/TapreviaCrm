/**
 * Phase 2A-3 synthetic fixtures on a fresh test-owned database.
 */
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const PID = process.env.PHASE2A2_TEST_PID ?? '';
const STORAGE = process.env.PHASE2A2_TEST_STORAGE ?? '';
const PORT = 27038;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a3c_head_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
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
  const oid = () => new ObjectId();
  const acme = oid();
  const alt = oid();
  const admin = oid();

  await db.collection('users').insertMany([
    { _id: acme, name: 'Acme QR', email: 'acme@test.local', passwordHash: 'x', role: 'customer', status: 'active', bizSlug: 'acme', hasStandy: true, createdAt: now, updatedAt: now },
    { _id: alt, name: 'Alt QR', email: 'alt@test.local', passwordHash: 'x', role: 'customer', status: 'active', bizSlug: 'alt', hasStandy: true, createdAt: now, updatedAt: now },
    { _id: admin, name: 'QR Admin', email: 'admin@test.local', passwordHash: 'x', role: 'admin', status: 'active', bizSlug: 'qradmin', hasStandy: false, createdAt: now, updatedAt: now },
  ]);
  await db.collection('profiles').insertMany([
    { userId: acme, displayName: 'Acme QR', companyInfo: { companyName: 'Acme QR' }, socialLinks: [{ platform: 'whatsapp', url: 'https://example.test/profile-whatsapp' }, { platform: 'instagram', url: 'https://example.test/profile-instagram' }], createdAt: now, updatedAt: now },
    { userId: alt, displayName: 'Alt QR', companyInfo: { companyName: 'Alt QR' }, socialLinks: [], createdAt: now, updatedAt: now },
  ]);

  const card = (input: {
    userId: ObjectId; cardUid: string; slug: string; routeSlug: string; uid: string;
    publicSlug: string; kind: string; redirectUrl?: string; reviewAssistant?: unknown;
  }) => ({
    _id: oid(), userId: input.userId, assignedUserId: input.userId,
    cardUid: input.cardUid, slug: input.slug, urlAlias: input.slug,
    routeSlug: input.routeSlug, uid: input.uid, publicSlug: input.publicSlug,
    kind: input.kind, redirectUrl: input.redirectUrl ?? '',
    ...(input.reviewAssistant ? { reviewAssistant: input.reviewAssistant } : {}),
    isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
  });

  const cards = [
    card({ userId: acme, cardUid: 'CARD1', slug: 'business-card', routeSlug: 'r_card', uid: 'u_card', publicSlug: 'acme/business-card', kind: 'profile' }),
    card({ userId: acme, cardUid: 'CARD2', slug: 'new-card', routeSlug: 'r_newcard', uid: 'u_newcard', publicSlug: 'acme/new-card', kind: 'profile' }),
    card({ userId: acme, cardUid: 'CARD3', slug: 'review-card', routeSlug: 'r_reviewcard', uid: 'u_reviewcard', publicSlug: 'acme/review-card', kind: 'review', reviewAssistant: {
      enabled: true, googleReviewUrl: 'https://example.test/qr-google', writingStyle: 'friendly', preferredLength: 'medium',
      languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome', category: '', employees: [], services: [], keywords: [],
    } }),
    card({ userId: acme, cardUid: 'CARD4', slug: 'collision-card', routeSlug: 'r_collision', uid: 'u_collision', publicSlug: 'acme/collision-card', kind: 'profile' }),
  ];
  await db.collection('cards').insertMany(cards);

  const standee = (input: {
    userId: ObjectId; name: string; publicSlug?: string | null; routeSlug: string; uid: string;
    maxProfiles?: number; fixedProfiles?: string[]; productKey?: string;
    slots: Array<{ platform: string; qrId: string; destinationUrl: string }>; panelQr: string;
  }) => ({
    _id: oid(), userId: input.userId, name: input.name, displayName: input.name,
    ...(input.publicSlug ? { publicSlug: input.publicSlug } : {}),
    routeSlug: input.routeSlug, uid: input.uid,
    productKey: input.productKey ?? 'BUSINESS_PROFILE_STANDEE',
    ...(input.maxProfiles !== undefined ? { maxProfiles: input.maxProfiles } : {}),
    ...(input.fixedProfiles ? { fixedProfiles: input.fixedProfiles } : {}),
    panelQr: { qrId: input.panelQr, qrColor: '#000000' },
    socialQrs: input.slots.map((s) => ({ ...s, qrColor: '#000000', label: s.platform })),
    createdAt: now, updatedAt: now,
  });

  const standees = [
    standee({ userId: acme, name: 'Standard', publicSlug: 'acme/standee', routeSlug: 'r_standee', uid: 'u_standee', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_standee', destinationUrl: 'https://example.test/standee' }], panelQr: 'panel_standee' }),
    standee({ userId: acme, name: 'Standard Two', publicSlug: 'acme/standee-2', routeSlug: 'r_standee2', uid: 'u_standee2', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_standee2', destinationUrl: 'https://example.test/standee2' }], panelQr: 'panel_standee2' }),
    standee({ userId: acme, name: 'AIO 3', publicSlug: 'acme/standee-3', routeSlug: 'r_aio3', uid: 'u_aio3', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_aio3_1', destinationUrl: 'https://example.test/aio3-google' },
      { platform: 'instagram', qrId: 'soc_aio3_2', destinationUrl: 'https://example.test/aio3-instagram' },
      { platform: 'facebook', qrId: 'soc_aio3_3', destinationUrl: 'https://example.test/aio3-facebook' },
    ], panelQr: 'panel_aio3' }),
    standee({ userId: acme, name: 'AIO 4', publicSlug: 'acme/standee-4', routeSlug: 'r_aio4', uid: 'u_aio4', maxProfiles: 4, fixedProfiles: ['google_review', 'instagram', 'whatsapp', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_4', slots: [
      { platform: 'google_review', qrId: 'soc_aio4_1', destinationUrl: 'https://example.test/aio4-google' },
      { platform: 'instagram', qrId: 'soc_aio4_2', destinationUrl: 'https://example.test/aio4-instagram' },
      { platform: 'whatsapp', qrId: 'soc_aio4_3', destinationUrl: 'https://example.test/aio4-whatsapp' },
      { platform: 'facebook', qrId: 'soc_aio4_4', destinationUrl: 'https://example.test/aio4-facebook' },
    ], panelQr: 'panel_aio4' }),
    standee({ userId: acme, name: 'Legacy AIO', publicSlug: 'acme/standee-5', routeSlug: 'r_legacy', uid: 'u_legacy', slots: [
      { platform: 'instagram', qrId: 'soc_legacy_1', destinationUrl: 'https://example.test/legacy-instagram' },
      { platform: 'facebook', qrId: 'soc_legacy_2', destinationUrl: 'https://example.test/legacy-facebook' },
      { platform: 'whatsapp', qrId: 'soc_legacy_3', destinationUrl: 'https://example.test/legacy-whatsapp' },
    ], panelQr: 'panel_legacy' }),
    standee({ userId: acme, name: 'Review Standee', publicSlug: 'acme/standee-6', routeSlug: 'r_reviewstandee', uid: 'u_reviewstandee', maxProfiles: 1, fixedProfiles: ['google_review'], productKey: 'GOOGLE_REVIEW_STANDEE', slots: [{ platform: 'google_review', qrId: 'soc_review', destinationUrl: 'https://example.test/review-google' }], panelQr: 'panel_review' }),
    standee({ userId: acme, name: 'Unconfigured', publicSlug: 'acme/standee-7', routeSlug: 'r_unconfig', uid: 'u_unconfig', maxProfiles: 1, fixedProfiles: ['linkedin'], slots: [{ platform: 'linkedin', qrId: 'soc_unconfig', destinationUrl: '' }], panelQr: 'panel_unconfig' }),
    standee({ userId: acme, name: 'No Public Slug', routeSlug: 'r_noslug', uid: 'u_noslug', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_noslug', destinationUrl: 'https://example.test/noslug' }], panelQr: 'panel_noslug' }),
    standee({ userId: acme, name: 'Profile Social Single', publicSlug: 'acme/standee-8', routeSlug: 'r_profilesocial', uid: 'u_profilesocial', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_profilesocial', destinationUrl: '' }], panelQr: 'panel_profilesocial' }),
    standee({ userId: acme, name: 'Ambiguous Standee', publicSlug: 'acme/standee-9', routeSlug: 'r_ambiguous', uid: 'u_ambiguous', slots: [{ platform: 'whatsapp', qrId: 'soc_ambiguous', destinationUrl: 'https://example.test/ambiguous' }], panelQr: 'panel_ambiguous' }),
    standee({ userId: oid(), name: 'Orphan Standee', publicSlug: 'orphan/standee', routeSlug: 'r_orphanstandee', uid: 'u_orphanstandee', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_orphanstandee', destinationUrl: 'https://example.test/orphan-standee' }], panelQr: 'panel_orphanstandee' }),
    standee({ userId: alt, name: 'Alt Collision Standee', publicSlug: 'alt/standee', routeSlug: 'r_collision', uid: 'u_alt_collision', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_alt_collision', destinationUrl: 'https://example.test/alt-collision' }], panelQr: 'panel_alt' }),
  ];
  await db.collection('standees').insertMany(standees);
  const bySlug = new Map(standees.map((s) => [s.publicSlug, s]));

  const catalogBusiness = oid();
  const catalogGoogle = oid();
  await db.collection('catalogproducts').insertMany([
    { _id: catalogBusiness, name: 'Business NFC Card', slug: 'business-nfc-card', kind: 'profile', category: 'nfc_card', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: catalogGoogle, name: 'Google Review Standee', slug: 'google-review-standee', kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);
  const assignments: any[] = [];
  for (const c of cards) {
    const product = c.kind === 'review' ? catalogGoogle : catalogBusiness;
    assignments.push({ _id: oid(), userId: c.userId, catalogProductId: product, cardId: c._id, standeeId: null, status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now });
  }
  for (const s of standees) {
    if (s.publicSlug === 'acme/standee-6') continue;
    assignments.push({ _id: oid(), userId: s.userId, catalogProductId: catalogBusiness, cardId: null, standeeId: s._id, status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now });
  }
  assignments.push({ _id: oid(), userId: acme, catalogProductId: catalogGoogle, cardId: null, standeeId: bySlug.get('acme/standee-6')!._id, status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now });
  await db.collection('userproducts').insertMany(assignments);

  await db.collection('reviewsettings').insertOne({
    businessId: acme, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: 'https://example.test/qr-central-google', welcomeMessage: '', businessName: 'Acme QR' },
    content: {
      category: '', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  });

  await db.collection('public_url_reservations').createIndex({ path: 1 }, { unique: true, name: 'path_1' });
  await db.collection('public_url_reservations').insertMany(
    standees.filter((s) => s.publicSlug).map((s) => ({
      path: s.publicSlug, kind: 'standee', instanceId: s._id, ownerId: s.userId,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    }))
  );
  await db.collection<{ _id: string; seq: number }>('counters').insertOne({ _id: 'public-url-reservation:ready', seq: 1 });
  await db.collection('analyticslogs').insertOne({
    _id: oid(), cardId: null, action: 'tap', metadata: 'historical:phase2a3',
    ip: '', userAgent: '', timestamp: now, createdAt: now, updatedAt: now,
  });

  console.log(JSON.stringify({
    database: DB,
    userIds: { acme: String(acme), alt: String(alt), admin: String(admin) },
    cards: cards.map((c) => ({ cardUid: c.cardUid, routeSlug: c.routeSlug, publicSlug: c.publicSlug })),
    standees: standees.map((s) => ({ routeSlug: s.routeSlug, publicSlug: s.publicSlug ?? null })),
  }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
