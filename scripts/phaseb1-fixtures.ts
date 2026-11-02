/**
 * Phase B.1 synthetic fixtures — DISPOSABLE DATABASE ONLY.
 *
 * Every insert is fabricated. The guard refuses to run unless the connection
 * points at the isolated mongod port and a `taprevia_phaseb1_` database, so a
 * misconfigured env var can never seed a real database.
 */

import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';

export const B1_PORT = '27019';
export const B1_DB_PREFIX = 'taprevia_phaseb1_';

export function assertIsolatedTarget(): { uri: string; db: string } {
  const uri = process.env.MONGODB_URI ?? '';
  const db = process.env.MONGODB_DB ?? '';
  if (!uri.includes(`127.0.0.1:${B1_PORT}`) || !db.startsWith(B1_DB_PREFIX)) {
    throw new Error(`Refusing non-isolated test target: ${uri || '(unset)'} / ${db || '(unset)'}`);
  }
  return { uri, db };
}

export const oid = (tail: string) => new mongoose.Types.ObjectId(tail.padStart(24, '0'));

export const IDS = {
  owner: oid('b1001'),
  other: oid('b1002'),
  noSettings: oid('b1003'),

  premiumProduct: oid('b1101'),
  reviewCardProduct: oid('b1102'),
  plateProduct: oid('b1103'),
  standeeProduct: oid('b1104'),
  aio3Product: oid('b1105'),
  aio4Product: oid('b1106'),

  cafeCategory: oid('b1201'),
  langCategory: oid('b1211'),
  personalCategory: oid('b1212'),
  rotationCategory: oid('b1213'),

  cafeTemplate: oid('b1301'),
  cafeTemplate2: oid('b1302'),
  cafeShortTemplate: oid('b1303'),
  germanTemplate: oid('b1311'),
  englishTemplate: oid('b1312'),
  personalTemplate: oid('b1321'),
  rotationOne: oid('b1331'),
  rotationTwo: oid('b1332'),

  legacyCard: oid('b1202'),
  centralCard: oid('b1203'),
  noCategoryCard: oid('b1204'),
  disabledCard: oid('b1205'),
  hybridCard: oid('b1206'),
  premiumCard: oid('b1207'),
  reviewCard: oid('b1208'),
  plateCard: oid('b1209'),
  personalCard: oid('b1210'),
  langCard: oid('b1214'),
  rotationCard: oid('b1215'),
  otherCard: oid('b1216'),

  legacyAssignment: oid('b1401'),
  centralAssignment: oid('b1402'),
  noCategoryAssignment: oid('b1403'),
  disabledAssignment: oid('b1404'),
  hybridAssignment: oid('b1405'),
  premiumAssignment: oid('b1406'),
  reviewCardAssignment: oid('b1407'),
  plateAssignment: oid('b1408'),
  personalAssignment: oid('b1409'),
  langAssignment: oid('b1410'),
  rotationAssignment: oid('b1411'),
  otherAssignment: oid('b1412'),

  standee: oid('b1501'),
  aio3: oid('b1502'),
  aio4: oid('b1503'),
  standeeAssignment: oid('b1511'),
  aio3Assignment: oid('b1512'),
  aio4Assignment: oid('b1513'),

  ownerProfile: oid('b1601'),
  otherProfile: oid('b1602'),
} as const;

export const ALIASES = {
  legacy: 'b1-legacy',
  central: 'b1-central',
  noCategory: 'b1-nocat',
  disabled: 'b1-disabled',
  hybrid: 'b1-hybrid',
  premium: 'b1-premium',
  reviewCard: 'b1-review-card',
  plate: 'b1-plate',
  personal: 'b1-personal',
  lang: 'b1-lang',
  rotation: 'b1-rotation',
  other: 'b1-other',
  standee: 'b1-standee',
  aio3: 'b1-aio3',
  aio4: 'b1-aio4',
} as const;

function reviewConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    googleReviewUrl: 'https://g.page/r/synthetic/review',
    languages: ['English'],
    category: 'cafe',
    writingStyle: 'friendly',
    preferredLength: 'medium',
    feedbackTopics: [],
    services: [],
    employees: [],
    keywords: [],
    welcomeMessage: '',
    ...overrides,
  };
}

/**
 * Drop + reseed the isolated database. Never call this against a real target:
 * `assertIsolatedTarget()` runs first and the script guard is repeated here.
 */
export async function seedPhaseb1(): Promise<void> {
  assertIsolatedTarget();
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  if (!db.databaseName.startsWith(B1_DB_PREFIX)) {
    throw new Error(`Refusing to drop non-B1 database: ${db.databaseName}`);
  }
  await db.dropDatabase();

  const now = new Date();

  await db.collection('users').insertMany([
    { _id: IDS.owner, name: 'B1 Owner', email: 'owner@phaseb1.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: IDS.other, name: 'B1 Other', email: 'other@phaseb1.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: IDS.noSettings, name: 'B1 No Settings', email: 'nosettings@phaseb1.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);

  await db.collection('catalogproducts').insertMany([
    { _id: IDS.premiumProduct, slug: 'premium-nfc-card', name: 'Premium NFC Card', category: 'card', kind: 'profile', active: true, priceMinor: 0, sortOrder: 1, createdAt: now, updatedAt: now },
    { _id: IDS.reviewCardProduct, slug: 'google-review-card', name: 'Google Review Card', category: 'card', kind: 'review', active: true, priceMinor: 0, sortOrder: 2, createdAt: now, updatedAt: now },
    { _id: IDS.plateProduct, slug: 'google-review-nfc-plate', name: 'Google Review NFC Plate', category: 'plate', kind: 'review', active: true, priceMinor: 0, sortOrder: 3, createdAt: now, updatedAt: now },
    { _id: IDS.standeeProduct, slug: 'google-review-standee', name: 'Google Review Standee', category: 'standee', kind: 'standee', active: true, priceMinor: 0, sortOrder: 4, createdAt: now, updatedAt: now },
    { _id: IDS.aio3Product, slug: 'all-in-one-standee-3', name: 'All In One Standee - 3 Profile', category: 'standee', kind: 'standee', active: true, priceMinor: 0, sortOrder: 5, createdAt: now, updatedAt: now },
    { _id: IDS.aio4Product, slug: 'all-in-one-standee-4', name: 'All In One Standee - 4 Profile', category: 'standee', kind: 'standee', active: true, priceMinor: 0, sortOrder: 6, createdAt: now, updatedAt: now },
  ]);

  const card = (input: {
    id: mongoose.Types.ObjectId;
    alias: string;
    name: string;
    kind?: string;
    userId?: mongoose.Types.ObjectId;
    source?: string;
    review?: Record<string, unknown>;
    overrides?: Record<string, unknown>;
  }) => ({
    _id: input.id,
    cardUid: `B1-${input.alias}`,
    slug: input.alias,
    routeSlug: input.alias,
    urlAlias: input.alias,
    publicSlug: `phaseb1/${input.alias}`,
    name: input.name,
    cardLabel: '',
    kind: input.kind ?? 'profile',
    userId: input.userId ?? IDS.owner,
    assignedUserId: input.userId ?? IDS.owner,
    status: 'active',
    isActive: true,
    setupComplete: true,
    ...(input.source ? { reviewSettingsSource: input.source } : {}),
    ...(input.overrides ? { reviewOverrides: input.overrides } : {}),
    reviewAssistant: input.review ?? reviewConfig(),
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('cards').insertMany([
    card({ id: IDS.legacyCard, alias: ALIASES.legacy, name: 'Legacy Business' }),
    card({
      id: IDS.centralCard,
      alias: ALIASES.central,
      name: 'Central Card',
      source: 'central',
      review: reviewConfig({ enabled: false, googleReviewUrl: '', category: '' }),
    }),
    card({
      id: IDS.noCategoryCard,
      alias: ALIASES.noCategory,
      name: 'No Category Business',
      review: reviewConfig({ category: '' }),
    }),
    card({
      id: IDS.disabledCard,
      alias: ALIASES.disabled,
      name: 'Disabled Business',
      review: reviewConfig({ enabled: false }),
    }),
    card({
      id: IDS.hybridCard,
      alias: ALIASES.hybrid,
      name: 'Hybrid Business',
      source: 'hybrid',
      review: reviewConfig({ category: 'unrelated-category' }),
      overrides: { category: 'cafe', welcomeMessage: 'Hybrid welcome' },
    }),
    card({
      id: IDS.premiumCard,
      alias: ALIASES.premium,
      name: 'Premium Business',
      kind: 'profile',
    }),
    card({
      id: IDS.reviewCard,
      alias: ALIASES.reviewCard,
      name: 'Review Card Business',
      kind: 'review',
    }),
    card({
      id: IDS.plateCard,
      alias: ALIASES.plate,
      name: 'Plate Business',
      kind: 'review',
    }),
    card({
      id: IDS.personalCard,
      alias: ALIASES.personal,
      name: 'Personal Business',
      review: reviewConfig({
        category: 'personal-cafe',
        employees: ['Asha'],
        services: ['Coffee'],
        keywords: ['cosy'],
      }),
    }),
    card({
      id: IDS.langCard,
      alias: ALIASES.lang,
      name: 'Lang Business',
      review: reviewConfig({ category: 'lang-cafe', languages: ['German'] }),
    }),
    card({
      id: IDS.rotationCard,
      alias: ALIASES.rotation,
      name: 'Rotation Business',
      review: reviewConfig({ category: 'rotation-cafe' }),
    }),
    card({
      id: IDS.otherCard,
      alias: ALIASES.other,
      name: 'Other Card',
      userId: IDS.other,
      source: 'central',
    }),
  ]);

  const assignment = (
    id: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    catalogProductId: mongoose.Types.ObjectId,
    options: { cardId?: mongoose.Types.ObjectId; standeeId?: mongoose.Types.ObjectId } = {}
  ) => ({
    _id: id,
    userId,
    catalogProductId,
    cardId: options.cardId ?? null,
    standeeId: options.standeeId ?? null,
    quantity: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('userproducts').insertMany([
    assignment(IDS.legacyAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.legacyCard }),
    assignment(IDS.centralAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.centralCard }),
    assignment(IDS.noCategoryAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.noCategoryCard }),
    assignment(IDS.disabledAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.disabledCard }),
    assignment(IDS.hybridAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.hybridCard }),
    assignment(IDS.premiumAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.premiumCard }),
    assignment(IDS.reviewCardAssignment, IDS.owner, IDS.reviewCardProduct, { cardId: IDS.reviewCard }),
    assignment(IDS.plateAssignment, IDS.owner, IDS.plateProduct, { cardId: IDS.plateCard }),
    assignment(IDS.personalAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.personalCard }),
    assignment(IDS.langAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.langCard }),
    assignment(IDS.rotationAssignment, IDS.owner, IDS.premiumProduct, { cardId: IDS.rotationCard }),
    assignment(IDS.otherAssignment, IDS.other, IDS.premiumProduct, { cardId: IDS.otherCard }),
    assignment(IDS.standeeAssignment, IDS.owner, IDS.standeeProduct, { standeeId: IDS.standee }),
    assignment(IDS.aio3Assignment, IDS.owner, IDS.aio3Product, { standeeId: IDS.aio3 }),
    assignment(IDS.aio4Assignment, IDS.owner, IDS.aio4Product, { standeeId: IDS.aio4 }),
  ]);

  await db.collection('reviewcategories').insertMany([
    {
      _id: IDS.cafeCategory,
      key: 'cafe',
      name: 'Cafe',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }, { key: 'quality', name: 'Quality' }, { key: 'quick', name: 'Quick visit' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: IDS.langCategory,
      key: 'lang-cafe',
      name: 'Language Cafe',
      active: true,
      languages: ['English', 'German'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: IDS.personalCategory,
      key: 'personal-cafe',
      name: 'Personal Cafe',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: IDS.rotationCategory,
      key: 'rotation-cafe',
      name: 'Rotation Cafe',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'one', name: 'One' }, { key: 'two', name: 'Two' }],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const template = (input: {
    id: mongoose.Types.ObjectId;
    key: string;
    categoryKey: string;
    scenario: string;
    text: string;
    language?: string;
    length?: string;
    style?: string;
    keywords?: string[];
  }) => ({
    _id: input.id,
    key: input.key,
    categoryKey: input.categoryKey,
    scenario: input.scenario,
    language: input.language ?? 'English',
    text: input.text,
    variables: Array.from(input.text.matchAll(/\{(\w+)\}/g)).map((m) => m[1]),
    length: input.length ?? 'medium',
    style: input.style ?? 'friendly',
    compatibleKeywords: input.keywords ?? [],
    active: true,
    usageCount: 0,
    lastShownAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('reviewtemplates').insertMany([
    template({ id: IDS.cafeTemplate, key: 'b1-cafe-service', categoryKey: 'cafe', scenario: 'service', text: 'Great service at {businessName}. The team was helpful and the experience felt personal.' }),
    template({ id: IDS.cafeTemplate2, key: 'b1-cafe-quality', categoryKey: 'cafe', scenario: 'quality', text: 'A lovely experience at {businessName}. Everything felt considered and welcoming.' }),
    template({ id: IDS.cafeShortTemplate, key: 'b1-cafe-short', categoryKey: 'cafe', scenario: 'quick', text: 'Quick, friendly service at {businessName}.', length: 'short', style: 'professional' }),
    template({ id: IDS.germanTemplate, key: 'b1-lang-german', categoryKey: 'lang-cafe', scenario: 'service', text: 'Toller Service bei {businessName}. Das Team war freundlich und aufmerksam.', language: 'German' }),
    template({ id: IDS.englishTemplate, key: 'b1-lang-english', categoryKey: 'lang-cafe', scenario: 'service', text: 'Great service at {businessName}.', language: 'English' }),
    template({ id: IDS.personalTemplate, key: 'b1-personal', categoryKey: 'personal-cafe', scenario: 'service', text: 'I want to thank {employee} at {businessName} for the excellent {service}. The {keyword} atmosphere made it memorable.', keywords: ['cosy'] }),
    template({ id: IDS.rotationOne, key: 'b1-rotation-one', categoryKey: 'rotation-cafe', scenario: 'one', text: 'Rotation choice one for {businessName}.' }),
    template({ id: IDS.rotationTwo, key: 'b1-rotation-two', categoryKey: 'rotation-cafe', scenario: 'two', text: 'Rotation choice two for {businessName}.' }),
  ]);

  await db.collection('reviewsettings').insertMany([
    {
      _id: oid('b1701'),
      businessId: IDS.owner,
      schemaVersion: 1,
      general: {
        enabled: true,
        googleReviewUrl: 'https://g.page/r/central/review',
        welcomeMessage: 'Central welcome',
        businessName: 'Central Business',
      },
      content: {
        category: 'cafe',
        languages: ['English'],
        writingStyle: 'professional',
        preferredLength: 'medium',
        styleMode: 'fixed',
        lengthMode: 'fixed',
        feedbackTopics: ['service'],
        services: ['Coffee'],
        employees: ['Asha'],
        keywords: ['cosy'],
      },
      createdAt: now,
      updatedAt: now,
      __v: 0,
    },
    {
      _id: oid('b1702'),
      businessId: IDS.other,
      schemaVersion: 1,
      general: {
        enabled: true,
        googleReviewUrl: 'https://g.page/r/other/review',
        welcomeMessage: '',
        businessName: 'Other Business',
      },
      content: {
        category: 'cafe',
        languages: ['English'],
        writingStyle: 'friendly',
        preferredLength: 'medium',
        styleMode: 'fixed',
        lengthMode: 'fixed',
        feedbackTopics: [],
        services: [],
        employees: [],
        keywords: [],
      },
      createdAt: now,
      updatedAt: now,
      __v: 0,
    },
  ]);

  const standee = (input: {
    id: mongoose.Types.ObjectId;
    routeSlug: string;
    name: string;
    slots: Array<{ platform: string; destinationUrl: string }>;
  }) => ({
    _id: input.id,
    userId: IDS.owner,
    uid: input.routeSlug,
    routeSlug: input.routeSlug,
    name: input.name,
    displayName: input.name,
    status: 'active',
    productKey: 'google-review-standee',
    panelQr: { qrId: `b1-panel-${input.routeSlug}`, qrColor: '#000000' },
    socialQrs: input.slots.map((slot) => ({ ...slot, label: slot.platform })),
    reviewSettingsSource: undefined,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('standees').insertMany([
    standee({
      id: IDS.standee,
      routeSlug: ALIASES.standee,
      name: 'Standee Business',
      slots: [{ platform: 'google_review', destinationUrl: 'https://g.page/r/standee/review' }],
    }),
    standee({
      id: IDS.aio3,
      routeSlug: ALIASES.aio3,
      name: 'AIO3 Business',
      slots: [
        { platform: 'google_review', destinationUrl: 'https://g.page/r/aio3/review' },
        { platform: 'instagram', destinationUrl: 'https://instagram.com/aio3' },
        { platform: 'facebook', destinationUrl: 'https://facebook.com/aio3' },
      ],
    }),
    standee({
      id: IDS.aio4,
      routeSlug: ALIASES.aio4,
      name: 'AIO4 Business',
      slots: [
        { platform: 'google_review', destinationUrl: 'https://g.page/r/aio4/review' },
        { platform: 'instagram', destinationUrl: 'https://instagram.com/aio4' },
        { platform: 'whatsapp', destinationUrl: 'https://wa.me/10000000000' },
        { platform: 'facebook', destinationUrl: 'https://facebook.com/aio4' },
      ],
    }),
  ]);

  await db.collection('profiles').insertMany([
    {
      _id: IDS.ownerProfile,
      userId: IDS.owner,
      companyInfo: { companyName: 'Owner Co' },
      socialLinks: [{ platform: 'google_review', url: 'https://g.page/r/owner/review' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: IDS.otherProfile,
      userId: IDS.other,
      companyInfo: { companyName: 'Other Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  // Start with no AI provider configured: Engine A is the default.
  await db.collection('tenantsettings').deleteMany({});
  await db.collection('analyticslogs').deleteMany({});
  await db.collection('ratecounters').deleteMany({});
  await db.collection('reviews').deleteMany({});
}

/** Stable projection of records that must never drift during tests. */
export async function snapshotProtectedData() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');
  const cards = await db
    .collection('cards')
    .find({}, { projection: { urlAlias: 1, slug: 1, routeSlug: 1, publicSlug: 1, name: 1, kind: 1, reviewAssistant: 1, reviewSettingsSource: 1, reviewOverrides: 1, userId: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const standees = await db
    .collection('standees')
    .find({}, { projection: { routeSlug: 1, uid: 1, socialQrs: 1, userId: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const assignments = await db
    .collection('userproducts')
    .find({}, { projection: { userId: 1, catalogProductId: 1, cardId: 1, standeeId: 1, status: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const reviewSettings = await db
    .collection('reviewsettings')
    .find({}, { projection: { businessId: 1, general: 1, content: 1 } })
    .sort({ _id: 1 })
    .toArray();
  const categories = await db.collection('reviewcategories').find({}).sort({ _id: 1 }).toArray();
  // Rotation metrics (usageCount/lastShownAt) are expected to change at
  // runtime; template content and eligibility must not.
  const templates = await db
    .collection('reviewtemplates')
    .find({}, { projection: { key: 1, categoryKey: 1, scenario: 1, language: 1, text: 1, length: 1, style: 1, compatibleKeywords: 1, active: 1 } })
    .sort({ _id: 1 })
    .toArray();
  return JSON.parse(JSON.stringify({ cards, standees, assignments, reviewSettings, categories, templates }));
}
