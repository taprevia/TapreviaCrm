/**
 * Phase 2A-2 security-patch synthetic fixtures.
 *
 * Fresh test-owned database only; refuses any non-loopback URI, wrong DB,
 * wrong PID, or wrong storage path.
 */
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const PID = process.env.PHASE2A2_TEST_PID ?? '';
const STORAGE = process.env.PHASE2A2_TEST_STORAGE ?? '';
const PORT = 27033;

function validate(): void {
  if (URI !== `mongodb://127.0.0.1:${PORT}`) throw new Error('BLOCKED — wrong test URI');
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) throw new Error('BLOCKED — remote URI');
  if (!/^taprevia_phase2a2_patch_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
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
  const users: Record<string, ObjectId> = {};

  const userDefs: Array<[string, string, string, string]> = [
    ['activecard', 'Patch Active Card', 'patchactive', 'active'],
    ['suspcard', 'Patch Suspended Card', 'patchsusp', 'active'],
    ['standee', 'Patch Standee', 'patchstandee', 'active'],
    ['aio3', 'Patch AIO3', 'patchaio3', 'active'],
    ['aio4', 'Patch AIO4', 'patchaio4', 'active'],
    ['legacy', 'Patch Legacy', 'patchlegacy', 'active'],
    ['review', 'Patch Review', 'patchreview', 'active'],
    ['admin', 'Patch Admin', 'patchadmin', 'active'],
  ];

  for (const [key, name, bizSlug, status] of userDefs) {
    users[key] = oid();
    await db.collection('users').insertOne({
      _id: users[key], name, email: `${key}@test.local`, passwordHash: 'x',
      role: key === 'admin' ? 'admin' : 'customer', status, bizSlug, hasStandy: true,
      createdAt: now, updatedAt: now,
    });
    await db.collection('profiles').insertOne({
      userId: users[key], displayName: name, companyInfo: { companyName: name },
      socialLinks: [], createdAt: now, updatedAt: now,
    });
  }

  const card = (input: {
    userId: ObjectId; key: string; slug: string; routeSlug: string; uid: string;
    publicSlug: string; kind: string; redirectUrl?: string; reviewAssistant?: unknown;
    cardUid: string;
  }) => ({
    _id: oid(), userId: input.userId, assignedUserId: input.userId,
    cardUid: input.cardUid, slug: input.slug, urlAlias: input.slug,
    routeSlug: input.routeSlug, uid: input.uid, publicSlug: input.publicSlug,
    kind: input.kind, redirectUrl: input.redirectUrl ?? '',
    ...(input.reviewAssistant ? { reviewAssistant: input.reviewAssistant } : {}),
    isActive: true, status: 'active', stats: { taps: 0 }, createdAt: now, updatedAt: now,
  });

  const cards = [
    card({ userId: users.activecard, key: 'pcp', slug: 'pc-profile', routeSlug: 'r_pc_profile', uid: 'u_pc_profile', publicSlug: 'patchactive/profile-card', kind: 'profile', cardUid: 'CARD_PC_PROFILE' }),
    card({ userId: users.activecard, key: 'pcs', slug: 'pc-social', routeSlug: 'r_pc_social', uid: 'u_pc_social', publicSlug: 'patchactive/social-card', kind: 'social', redirectUrl: 'https://example.test/pc-social', cardUid: 'CARD_PC_SOCIAL' }),
    card({ userId: users.activecard, key: 'pcc', slug: 'pc-collision', routeSlug: 'r_collision', uid: 'u_pc_collision', publicSlug: 'patchactive/collision-card', kind: 'profile', cardUid: 'CARD_PC_COLLISION' }),
    card({ userId: users.suspcard, key: 'scp', slug: 'sc-profile', routeSlug: 'r_sc_profile', uid: 'u_sc_profile', publicSlug: 'patchsusp/profile-card', kind: 'profile', cardUid: 'CARD_SC_PROFILE' }),
    card({ userId: users.suspcard, key: 'scs', slug: 'sc-social', routeSlug: 'r_sc_social', uid: 'u_sc_social', publicSlug: 'patchsusp/social-card', kind: 'social', redirectUrl: 'https://example.test/sc-social', cardUid: 'CARD_SC_SOCIAL' }),
    card({ userId: users.review, key: 'prc', slug: 'pr-review', routeSlug: 'r_pr_card', uid: 'u_pr_card', publicSlug: 'patchreview/review-card', kind: 'review', cardUid: 'CARD_PR_REVIEW', reviewAssistant: {
      enabled: true, googleReviewUrl: 'https://example.test/pr-google', writingStyle: 'friendly',
      preferredLength: 'medium', languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome',
      category: '', employees: [], services: [], keywords: [],
    } }),
  ];
  await db.collection('cards').insertMany(cards);

  const standee = (input: {
    userId: ObjectId; name: string; publicSlug: string; routeSlug: string; uid: string;
    maxProfiles?: number; fixedProfiles?: string[]; productKey?: string;
    slots: Array<{ platform: string; qrId: string; destinationUrl: string }>;
    panelQr: string;
  }) => ({
    _id: oid(), userId: input.userId, name: input.name, displayName: input.name,
    publicSlug: input.publicSlug, routeSlug: input.routeSlug, uid: input.uid,
    productKey: input.productKey ?? 'BUSINESS_PROFILE_STANDEE',
    ...(input.maxProfiles !== undefined ? { maxProfiles: input.maxProfiles } : {}),
    ...(input.fixedProfiles ? { fixedProfiles: input.fixedProfiles } : {}),
    panelQr: { qrId: input.panelQr, qrColor: '#000000' },
    socialQrs: input.slots.map((s) => ({ ...s, qrColor: '#000000', label: s.platform })),
    createdAt: now, updatedAt: now,
  });

  const standees = [
    standee({ userId: users.standee, name: 'Patch Single', publicSlug: 'patchstandee/standee', routeSlug: 'r_ps_single', uid: 'u_ps_single', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_ps_single', destinationUrl: 'https://example.test/ps-single' }], panelQr: 'panel_ps_single' }),
    standee({ userId: users.standee, name: 'Patch Collision Standee', publicSlug: 'patchstandee/collision', routeSlug: 'r_collision', uid: 'u_ps_collision', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_ps_collision', destinationUrl: 'https://example.test/standee-collision' }], panelQr: 'panel_ps_collision' }),
    standee({ userId: users.aio3, name: 'Patch AIO3', publicSlug: 'patchaio3/standee', routeSlug: 'r_pa3', uid: 'u_pa3', maxProfiles: 3, fixedProfiles: ['google_review', 'instagram', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_3', slots: [
      { platform: 'google_review', qrId: 'soc_pa3_1', destinationUrl: 'https://example.test/pa3-google' },
      { platform: 'instagram', qrId: 'soc_pa3_2', destinationUrl: 'https://example.test/pa3-instagram' },
      { platform: 'facebook', qrId: 'soc_pa3_3', destinationUrl: 'https://example.test/pa3-facebook' },
    ], panelQr: 'panel_pa3' }),
    standee({ userId: users.aio4, name: 'Patch AIO4', publicSlug: 'patchaio4/standee', routeSlug: 'r_pa4', uid: 'u_pa4', maxProfiles: 4, fixedProfiles: ['google_review', 'instagram', 'whatsapp', 'facebook'], productKey: 'ALL_IN_ONE_STANDEE_4', slots: [
      { platform: 'google_review', qrId: 'soc_pa4_1', destinationUrl: 'https://example.test/pa4-google' },
      { platform: 'instagram', qrId: 'soc_pa4_2', destinationUrl: 'https://example.test/pa4-instagram' },
      { platform: 'whatsapp', qrId: 'soc_pa4_3', destinationUrl: 'https://example.test/pa4-whatsapp' },
      { platform: 'facebook', qrId: 'soc_pa4_4', destinationUrl: 'https://example.test/pa4-facebook' },
    ], panelQr: 'panel_pa4' }),
    standee({ userId: users.legacy, name: 'Patch Legacy', publicSlug: 'patchlegacy/standee', routeSlug: 'r_pl', uid: 'u_pl', slots: [
      { platform: 'instagram', qrId: 'soc_pl_1', destinationUrl: 'https://example.test/pl-instagram' },
      { platform: 'facebook', qrId: 'soc_pl_2', destinationUrl: 'https://example.test/pl-facebook' },
      { platform: 'whatsapp', qrId: 'soc_pl_3', destinationUrl: 'https://example.test/pl-whatsapp' },
    ], panelQr: 'panel_pl' }),
    standee({ userId: users.review, name: 'Patch Review Host', publicSlug: 'patchreview/standee', routeSlug: 'r_pr', uid: 'u_pr', maxProfiles: 1, fixedProfiles: ['google_review'], productKey: 'GOOGLE_REVIEW_STANDEE', slots: [{ platform: 'google_review', qrId: 'soc_pr', destinationUrl: 'https://example.test/pr-google' }], panelQr: 'panel_pr' }),
    standee({ userId: oid(), name: 'Patch Orphan', publicSlug: 'patchorphan/standee', routeSlug: 'r_porphan', uid: 'u_porphan', maxProfiles: 1, fixedProfiles: ['whatsapp'], slots: [{ platform: 'whatsapp', qrId: 'soc_porphan', destinationUrl: 'https://example.test/orphan' }], panelQr: 'panel_porphan' }),
  ];
  await db.collection('standees').insertMany(standees);
  const standeeBySlug = new Map(standees.map((s) => [s.publicSlug, s]));

  const catalogGoogle = oid();
  const catalogBusiness = oid();
  await db.collection('catalogproducts').insertMany([
    { _id: catalogGoogle, name: 'Google Review Standee', slug: 'google-review-standee', kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: catalogBusiness, name: 'Business Profile Standee', slug: 'business-profile-standee', kind: 'standee', category: 'standee', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  ]);
  const assignments: any[] = [];
  const addAssignment = (userId: ObjectId, catalogProductId: ObjectId, standeeId: unknown) => {
    assignments.push({ _id: oid(), userId, catalogProductId, standeeId, status: 'active', quantity: 1, unitPriceMinor: 0, createdAt: now, updatedAt: now });
  };
  addAssignment(users.activecard, catalogBusiness, standeeBySlug.get('patchstandee/standee')!._id);
  addAssignment(users.standee, catalogBusiness, standeeBySlug.get('patchstandee/standee')!._id);
  addAssignment(users.aio3, catalogBusiness, standeeBySlug.get('patchaio3/standee')!._id);
  addAssignment(users.aio4, catalogBusiness, standeeBySlug.get('patchaio4/standee')!._id);
  addAssignment(users.legacy, catalogBusiness, standeeBySlug.get('patchlegacy/standee')!._id);
  addAssignment(users.review, catalogGoogle, standeeBySlug.get('patchreview/standee')!._id);
  await db.collection('userproducts').insertMany(assignments);

  await db.collection('reviewsettings').insertOne({
    businessId: users.review, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: 'https://example.test/pr-central-google', welcomeMessage: '', businessName: 'Patch Review' },
    content: {
      category: '', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  });

  await db.collection('public_url_reservations').createIndex({ path: 1 }, { unique: true, name: 'path_1' });
  await db.collection('public_url_reservations').insertMany(
    standees.map((s) => ({
      path: s.publicSlug, kind: 'standee', instanceId: s._id, ownerId: s.userId,
      status: 'active', source: 'backfill', issuedAt: now, retiredAt: null,
    }))
  );
  await db.collection<{ _id: string; seq: number }>('counters').insertOne({ _id: 'public-url-reservation:ready', seq: 1 });
  await db.collection('analyticslogs').insertOne({
    _id: oid(), cardId: null, action: 'tap', metadata: 'historical:patch',
    ip: '', userAgent: '', timestamp: now, createdAt: now, updatedAt: now,
  });

  console.log(JSON.stringify({
    database: DB,
    userIds: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, String(v)])),
    standeeSlugs: standees.map((s) => s.publicSlug),
    cardSlugs: cards.map((c) => c.publicSlug),
  }, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
