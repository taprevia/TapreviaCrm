/**
 * Phase 2A-2 final synthetic fixtures.
 *
 * Creates a brand-new test-owned database on the dedicated loopback mongod.
 * Refuses to run unless URI, DB name, PID, storage, and port all match the
 * dedicated test process. No application models or env files are used.
 */
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const PID = process.env.PHASE2A2_TEST_PID ?? '';
const STORAGE = process.env.PHASE2A2_TEST_STORAGE ?? '';
const PORT = 27032;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_final_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  const cmd = execFileSync('ps', ['-p', PID, '-o', 'command='], { encoding: 'utf8' });
  if (
    !cmd.includes('mongod') ||
    !cmd.includes(`--dbpath ${STORAGE}/db`) ||
    !cmd.includes(`--port ${PORT}`) ||
    !cmd.includes('--bind_ip 127.0.0.1')
  ) {
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
  const users: Record<string, ObjectId> = {};
  const userDefs: Array<[string, string, string, string]> = [
    ['acme', 'Acme Final', 'acme', 'active'],
    ['cardbiz', 'Card Biz', 'cardbiz', 'active'],
    ['reviewpub', 'Review Published', 'reviewpub', 'active'],
    ['reviewunpub', 'Review Unpublished', 'reviewunpub', 'active'],
    ['reviewmiss', 'Review Missing', 'reviewmiss', 'active'],
    ['reviewinvalid', 'Review Invalid', 'reviewinvalid', 'active'],
    ['reviewdisabled', 'Review Disabled', 'reviewdisabled', 'active'],
    ['e04biz', 'E04 Biz', 'e04biz', 'active'],
    ['e12delbiz', 'E12 Delete Biz', 'e12delbiz', 'active'],
    ['e12suspbiz', 'E12 Suspended Biz', 'e12suspbiz', 'suspended'],
    ['e11alloc', 'E11 Allocation Biz', 'e11alloc', 'active'],
  ];
  for (const [key, name, bizSlug, status] of userDefs) {
    users[key] = oid();
    await db.collection('users').insertOne({
      _id: users[key], name, email: `${key}@test.local`, passwordHash: 'x',
      role: 'customer', status, bizSlug, hasStandy: true, createdAt: now, updatedAt: now,
    });
    await db.collection('profiles').insertOne({
      userId: users[key], displayName: name, companyInfo: { companyName: name },
      socialLinks: [], createdAt: now, updatedAt: now,
    });
  }

  // Extra profile data for E04.
  await db.collection('profiles').updateOne(
    { userId: users.e04biz },
    { $set: { urlAlias: 'e04-profile', socialLinks: [
      { platform: 'instagram', url: 'https://example.test/e04-instagram' },
      { platform: 'facebook', url: 'https://example.test/e04-facebook' },
    ] } }
  );

  const makeStandee = (input: {
    userId: ObjectId; name: string; publicSlug: string; routeSlug?: string | null;
    uid?: string | null; maxProfiles?: number | null; fixedProfiles?: string[] | null;
    productKey?: string; slots?: Array<{ platform: string; qrId: string; destinationUrl: string }>;
  }) => ({
    _id: oid(),
    userId: input.userId,
    name: input.name,
    displayName: input.name,
    publicSlug: input.publicSlug,
    ...(input.routeSlug ? { routeSlug: input.routeSlug } : {}),
    ...(input.uid ? { uid: input.uid } : {}),
    productKey: input.productKey ?? 'BUSINESS_PROFILE_STANDEE',
    ...(input.maxProfiles !== undefined && input.maxProfiles !== null ? { maxProfiles: input.maxProfiles } : {}),
    ...(input.fixedProfiles ? { fixedProfiles: input.fixedProfiles } : {}),
    panelQr: { qrId: `panel_${input.publicSlug.replace(/[^a-z0-9]/gi, '_')}`, qrColor: '#000000' },
    socialQrs: (input.slots ?? []).map((slot) => ({ ...slot, qrColor: '#000000', label: slot.platform })),
    createdAt: now,
    updatedAt: now,
  });

  const standees: any[] = [
    makeStandee({ userId: users.acme, name: 'Single', publicSlug: 'acme/standee', routeSlug: 'r_single', uid: 'u_single', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_single', destinationUrl: 'https://example.test/final-single' }] }),
    makeStandee({ userId: users.acme, name: 'Single Two', publicSlug: 'acme/standee-2', routeSlug: 'r_single2', uid: 'u_single2', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_single2', destinationUrl: 'https://example.test/final-single2' }] }),
    makeStandee({ userId: users.acme, name: 'Unconfigured', publicSlug: 'acme/standee-3', routeSlug: 'r_unconfig', uid: 'u_unconfig', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_unconfig', destinationUrl: '' }] }),
    makeStandee({ userId: users.acme, name: 'AIO 3', publicSlug: 'acme/standee-4', routeSlug: 'r_aio3', uid: 'u_aio3', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_aio3_1', destinationUrl: 'https://example.test/final-aio3-google' },
      { platform: 'instagram', qrId: 'soc_aio3_2', destinationUrl: 'https://example.test/final-aio3-instagram' },
      { platform: 'facebook', qrId: 'soc_aio3_3', destinationUrl: '' },
    ] }),
    makeStandee({ userId: users.acme, name: 'AIO 4', publicSlug: 'acme/standee-5', routeSlug: 'r_aio4', uid: 'u_aio4', maxProfiles: 4, fixedProfiles: ['google_review', 'instagram', 'whatsapp', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_4', slots: [
      { platform: 'google_review', qrId: 'soc_aio4_1', destinationUrl: 'https://example.test/final-aio4-google' },
      { platform: 'instagram', qrId: 'soc_aio4_2', destinationUrl: 'https://example.test/final-aio4-instagram' },
      { platform: 'whatsapp', qrId: 'soc_aio4_3', destinationUrl: 'https://example.test/final-aio4-whatsapp' },
      { platform: 'facebook', qrId: 'soc_aio4_4', destinationUrl: 'https://example.test/final-aio4-facebook' },
    ] }),
    makeStandee({ userId: users.acme, name: 'Legacy AIO', publicSlug: 'acme/standee-6', routeSlug: 'r_legacy', uid: 'u_legacy', slots: [
      { platform: 'google_review', qrId: 'soc_legacy_1', destinationUrl: 'https://example.test/final-legacy-google' },
      { platform: 'instagram', qrId: 'soc_legacy_2', destinationUrl: 'https://example.test/final-legacy-instagram' },
      { platform: 'facebook', qrId: 'soc_legacy_3', destinationUrl: 'https://example.test/final-legacy-facebook' },
    ] }),
    makeStandee({ userId: users.acme, name: 'Collision Standee', publicSlug: 'acme/standee-7', routeSlug: 'r_collide', uid: 'u_collide', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_collide', destinationUrl: 'https://example.test/final-collide' }] }),
    makeStandee({ userId: users.acme, name: 'Self Loop', publicSlug: 'acme/standee-8', routeSlug: 'r_self', uid: 'u_self', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_self', destinationUrl: 'http://127.0.0.1:3201/acme/standee-8' }] }),
    makeStandee({ userId: users.acme, name: 'Zero Slot AIO3', publicSlug: 'acme/standee-9', routeSlug: 'r_zero3', uid: 'u_zero3', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [] }),
    makeStandee({ userId: users.acme, name: 'Zero Slot AIO4', publicSlug: 'acme/standee-10', routeSlug: 'r_zero4', uid: 'u_zero4', maxProfiles: 4, fixedProfiles: ['google_review', 'instagram', 'whatsapp', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_4', slots: [] }),
    makeStandee({ userId: users.acme, name: 'Empty Metadata', publicSlug: 'acme/standee-11', routeSlug: 'r_empty', uid: 'u_empty', slots: [] }),

    // E04 profile/social-link picker fixtures.
    makeStandee({ userId: users.e04biz, name: 'E04 Profile One', publicSlug: 'e04biz/standee', routeSlug: 'r_e04p1', uid: 'u_e04p1', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_e04p1', destinationUrl: '' }] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Profile Multi', publicSlug: 'e04biz/standee-2', routeSlug: 'r_e04pm', uid: 'u_e04pm', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_e04pm1', destinationUrl: '' },
      { platform: 'instagram', qrId: 'soc_e04pm2', destinationUrl: '' },
      { platform: 'facebook', qrId: 'soc_e04pm3', destinationUrl: '' },
    ] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Social One', publicSlug: 'e04biz/standee-3', routeSlug: 'r_e04s1', uid: 'u_e04s1', maxProfiles: 1, fixedProfiles: ['instagram'], slots: [{ platform: 'instagram', qrId: 'soc_e04s1', destinationUrl: '' }] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Social Multi', publicSlug: 'e04biz/standee-4', routeSlug: 'r_e04sm', uid: 'u_e04sm', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_e04sm1', destinationUrl: '' },
      { platform: 'instagram', qrId: 'soc_e04sm2', destinationUrl: '' },
      { platform: 'facebook', qrId: 'soc_e04sm3', destinationUrl: '' },
    ] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Mixed', publicSlug: 'e04biz/standee-5', routeSlug: 'r_e04mix', uid: 'u_e04mix', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_e04mix1', destinationUrl: 'https://example.test/e04-mix-direct' },
      { platform: 'instagram', qrId: 'soc_e04mix2', destinationUrl: '' },
      { platform: 'facebook', qrId: 'soc_e04mix3', destinationUrl: '' },
    ] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Invalid', publicSlug: 'e04biz/standee-6', routeSlug: 'r_e04bad', uid: 'u_e04bad', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_e04bad', destinationUrl: 'javascript:alert(1)' }] }),
    makeStandee({ userId: users.e04biz, name: 'E04 Legacy', publicSlug: 'e04biz/standee-7', routeSlug: 'r_e04legacy', uid: 'u_e04legacy', slots: [
      { platform: 'instagram', qrId: 'soc_e04legacy1', destinationUrl: 'https://example.test/e04-legacy-ig' },
      { platform: 'facebook', qrId: 'soc_e04legacy2', destinationUrl: 'https://example.test/e04-legacy-fb' },
      { platform: 'whatsapp', qrId: 'soc_e04legacy3', destinationUrl: 'https://example.test/e04-legacy-wa' },
    ] }),

    // E12 missing/deleted/suspended fixtures.
    makeStandee({ userId: users.e12delbiz, name: 'E12 Delete', publicSlug: 'e12delbiz/standee', routeSlug: 'r_e12del', uid: 'u_e12del', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_e12del', destinationUrl: 'https://example.test/e12-delete' }] }),
    makeStandee({ userId: users.e12suspbiz, name: 'E12 Suspended Owner', publicSlug: 'e12suspbiz/standee', routeSlug: 'r_e12susp', uid: 'u_e12susp', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_e12susp', destinationUrl: 'https://example.test/e12-suspended' }] }),

    // E11 allocation target (no publicSlug).
    makeStandee({ userId: users.e11alloc, name: 'E11 Allocation', publicSlug: '', routeSlug: 'r_e11alloc', uid: 'u_e11alloc', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_e11alloc', destinationUrl: 'https://example.test/e11' }] }),
  ];

  // Review-host standees (also grant review capability via UserProduct).
  for (const key of ['reviewpub', 'reviewunpub', 'reviewmiss', 'reviewinvalid', 'reviewdisabled'] as const) {
    standees.push(makeStandee({
      userId: users[key], name: `${key} review host`, publicSlug: `${key}/standee`,
      routeSlug: `r_${key}`, uid: `u_${key}`, maxProfiles: 1, fixedProfiles: ['google_review'],
      productKey: 'GOOGLE_REVIEW_STANDEE',
      slots: [{ platform: 'google_review', qrId: `soc_${key}`, destinationUrl: `https://example.test/${key}-google` }],
    }));
  }
  // E11 allocation target must have no publicSlug at all.
  for (const s of standees) if (!s.publicSlug) delete s.publicSlug;

  await db.collection('standees').insertMany(standees);
  const standeeBySlug = new Map(standees.filter((s) => s.publicSlug).map((s) => [s.publicSlug, s]));
  const e11Standee = standees.find((s) => !s.publicSlug)!;

  const cards: any[] = [
    {
      _id: oid(), userId: users.cardbiz, assignedUserId: users.cardbiz,
      cardUid: 'CARD_E01_SOCIAL', slug: 'e01-social', urlAlias: 'e01-social',
      routeSlug: 'r_e01_card', uid: 'u_e01_card', publicSlug: 'cardbiz/e01-card',
      kind: 'social', redirectUrl: 'https://example.test/e01-card',
      isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    },
    {
      _id: oid(), userId: users.cardbiz, assignedUserId: users.cardbiz,
      cardUid: 'CARD_E01_PROFILE', slug: 'e01-profile', urlAlias: 'e01-profile',
      routeSlug: 'r_e01_profile', uid: 'u_e01_profile', publicSlug: 'cardbiz/profile-card',
      kind: 'profile', isActive: true, status: 'active', stats: { taps: 0 },
      basic: { firstName: 'E01', lastName: 'Profile', company: 'Card Biz' },
      themeConfig: { accentColor: '#2563EB', bgColor: '#FFFFFF' }, createdAt: now, updatedAt: now,
    },
    {
      _id: oid(), userId: users.cardbiz, assignedUserId: users.cardbiz,
      cardUid: 'CARD_COLLIDE', slug: 'collision-card', urlAlias: 'collision-card',
      routeSlug: 'r_collide', uid: 'u_collide', publicSlug: 'cardbiz/collision-card',
      kind: 'profile', isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    },
    {
      _id: oid(), userId: users.cardbiz, assignedUserId: users.cardbiz,
      cardUid: 'CARD_SUSPENDED', slug: 'e01-suspended', urlAlias: 'e01-suspended',
      routeSlug: 'r_e01_susp', uid: 'u_e01_susp', publicSlug: 'cardbiz/suspended-card',
      kind: 'profile', isActive: true, status: 'suspended', stats: { taps: 0 }, createdAt: now, updatedAt: now,
    },
  ];

  const reviewCard = (key: string, slug: string, route: string, uid: string, assistant: any) => ({
    _id: oid(), userId: users[key], assignedUserId: users[key],
    cardUid: `CARD_${key.toUpperCase()}`, slug, urlAlias: slug,
    routeSlug: route, uid, publicSlug: `${key}/review-card`,
    kind: 'review', reviewAssistant: assistant,
    isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
  });

  const assistant = (url: string, enabled = true) => ({
    enabled, googleReviewUrl: url, writingStyle: 'friendly', preferredLength: 'medium',
    languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome',
    category: '', employees: [], services: [], keywords: [],
  });

  cards.push(
    reviewCard('reviewpub', 'e02-published', 'r_e02_pub', 'u_e02_pub', assistant('https://example.test/e02-published-google')),
    reviewCard('reviewunpub', 'e02-unpublished', 'r_e02_unpub', 'u_e02_unpub', assistant('https://example.test/e02-unpublished-google')),
    reviewCard('reviewmiss', 'e02-missing', 'r_e02_miss', 'u_e02_miss', assistant('')),
    reviewCard('reviewinvalid', 'e02-invalid', 'r_e02_invalid', 'u_e02_invalid', assistant('https://example.test/e02-invalid-google')),
    reviewCard('reviewdisabled', 'e02-disabled', 'r_e02_disabled', 'u_e02_disabled', assistant('https://example.test/e02-disabled-google', false)),
  );

  await db.collection('cards').insertMany(cards);

  const catalogIds: Record<string, ObjectId> = {
    google: oid(),
    business: oid(),
  };
  await db.collection('catalogproducts').insertMany([
    { _id: catalogIds.google, name: 'Google Review Standee', slug: 'google-review-standee', kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: catalogIds.business, name: 'Business Profile Standee', slug: 'business-profile-standee', kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);

  const assignments: any[] = [];
  const addAssignment = (userId: ObjectId, catalogProductId: ObjectId, standeeId: unknown) => {
    assignments.push({ _id: oid(), userId, catalogProductId, standeeId, status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now });
  };
  for (const slug of ['acme/standee', 'acme/standee-2', 'acme/standee-3', 'acme/standee-4', 'acme/standee-5', 'acme/standee-6', 'acme/standee-7', 'acme/standee-8', 'acme/standee-9', 'acme/standee-10', 'acme/standee-11']) {
    addAssignment(users.acme, catalogIds.business, standeeBySlug.get(slug)!._id);
  }
  for (const slug of ['e04biz/standee', 'e04biz/standee-2']) addAssignment(users.e04biz, catalogIds.business, standeeBySlug.get(slug)!._id);
  addAssignment(users.e12delbiz, catalogIds.business, standeeBySlug.get('e12delbiz/standee')!._id);
  addAssignment(users.e12suspbiz, catalogIds.business, standeeBySlug.get('e12suspbiz/standee')!._id);
  addAssignment(users.e11alloc, catalogIds.business, e11Standee._id);
  for (const key of ['reviewpub', 'reviewunpub', 'reviewmiss', 'reviewinvalid', 'reviewdisabled'] as const) {
    addAssignment(users[key], catalogIds.google, standeeBySlug.get(`${key}/standee`)!._id);
  }
  await db.collection('userproducts').insertMany(assignments);

  const central = (owner: ObjectId, enabled: boolean, url: string, name: string, schemaVersion = 1) => ({
    businessId: owner, schemaVersion,
    general: { enabled, googleReviewUrl: url, welcomeMessage: '', businessName: name },
    content: {
      category: '', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  });
  await db.collection('reviewsettings').insertMany([
    central(users.reviewpub, true, 'https://example.test/e02-central-published', 'Review Published'),
    central(users.reviewunpub, false, 'https://example.test/e02-central-unpublished', 'Review Unpublished'),
    central(users.reviewmiss, true, '', 'Review Missing'),
    central(users.reviewinvalid, true, 'https://example.test/e02-central-invalid', 'Review Invalid', 999),
  ]);

  // Phase 2A-1 readiness and permanent reservations.
  await db.collection('public_url_reservations').createIndex({ path: 1 }, { unique: true, name: 'path_1' });
  const reservations: any[] = standees
    .filter((s) => s.publicSlug)
    .map((s) => ({
      path: s.publicSlug, kind: 'standee', instanceId: s._id, ownerId: s.userId,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    }));
  reservations.push({
    path: 'e11alloc/standee', kind: 'standee', instanceId: null, ownerId: null,
    status: 'retired', source: 'backfill', issuedAt: now, retiredAt: now,
  });
  await db.collection('public_url_reservations').insertMany(reservations);
  await db.collection<{ _id: string; seq: number }>('counters').insertOne({ _id: 'public-url-reservation:ready', seq: 1 });
  await db.collection<{ _id: string; seq: number }>('counters').insertOne({ _id: 'standee-slug:e11alloc', seq: 0 });

  await db.collection('analyticslogs').insertOne({
    _id: oid(), cardId: null, action: 'tap', metadata: 'historical:final',
    ip: '', userAgent: '', timestamp: now, createdAt: now, updatedAt: now,
  });

  console.log(JSON.stringify({
    database: DB,
    userIds: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, String(v)])),
    standeeSlugs: standees.map((s) => s.publicSlug).filter(Boolean),
    cardSlugs: cards.map((c) => c.publicSlug),
    e11StandeeId: String(e11Standee._id),
  }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
