/**
 * Phase 4D.6 Google Review Standee regression suite.
 *
 * Runs against a disposable local MongoDB and a locally running Next server.
 * Seeds synthetic Standees, Cards, assignments, Review Library data and central
 * settings, then exercises the real redirects, public APIs, management APIs,
 * rotation, concurrency and AI orchestration.
 *
 * Usage:
 *   MONGODB_URI=mongodb://localhost:27017 \
 *   MONGODB_DB=taprevia_4d6_suite \
 *   TEST_BASE=http://localhost:3501 \
 *   EXPECT_STANDEE=true EXPECT_CENTRAL=true EXPECT_ROTATION=false \
 *   npx tsx scripts/test-standee-review.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import mongoose, { Types } from 'mongoose';
import User from '@/models/User';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import ReviewSettings from '@/models/ReviewSettings';
import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import ReviewRotationState from '@/models/ReviewRotationState';
import TenantSettings from '@/models/TenantSettings';
import AnalyticsLog from '@/models/AnalyticsLog';
import { connectDB } from '@/lib/db';
import { resolveEntitlement } from '@/lib/services/capability-access';
import {
  resolveStandeeEffectiveReviewSettings,
  resolveStandeeGoogleReviewUrl,
  resolveStandeeReviewHost,
  resolveStandeeReviewProduct,
  resolveStandeeSettingsSource,
} from '@/lib/services/review-standee-settings';
import { generateReviewForHost } from '@/lib/services/review-generate';
import { encryptSecret } from '@/lib/crypto';

const require = createRequire('/Users/prince/Documents/CRM/package.json');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE ?? 'http://localhost:3501';
const EXPECT_STANDEE = process.env.EXPECT_STANDEE === 'true';
const EXPECT_CENTRAL = process.env.EXPECT_CENTRAL === 'true';
const EXPECT_ROTATION = process.env.EXPECT_ROTATION === 'true';
const DB_NAME = process.env.MONGODB_DB ?? '';
const ISOLATED = DB_NAME.startsWith('taprevia_4d6_');
const LOCAL_BASE = ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);

if (!ISOLATED) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_4d6_ (got "${DB_NAME}")`);
  process.exit(2);
}
if (!LOCAL_BASE) {
  console.error(`Refusing to run against non-local TEST_BASE: ${BASE}`);
  process.exit(2);
}

const envFile = fs.readFileSync('/Users/prince/Documents/CRM/.env.local', 'utf8');
const envValue = (key: string) => {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(envFile);
  return match ? match[1].trim().replace(/^"|"$/g, '') : undefined;
};
if (!process.env.JWT_SECRET) {
  const secret = envValue('JWT_SECRET');
  if (secret) process.env.JWT_SECRET = secret;
}
if (!process.env.APP_KEY) {
  const appKey = envValue('APP_KEY');
  if (appKey) process.env.APP_KEY = appKey;
}
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is required');

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`FAIL ${name}: ${detail}`);
    process.exitCode = 1;
  }
}
function ok(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
function database(): NonNullable<typeof mongoose.connection.db> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  return db;
}

interface FixtureUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  role: string;
  status: string;
}

function userDoc(name: string, email: string, status = 'active'): FixtureUser & Record<string, unknown> {
  return {
    _id: oid(),
    name,
    email,
    role: 'customer',
    status,
    passwordHash: 'x'.repeat(32),
    createdAt: now,
    updatedAt: now,
  };
}

const users: Record<string, FixtureUser> = {};
const products: Record<string, Record<string, unknown>> = {};
const standees: Record<string, Record<string, unknown>> = {};
const cards: Record<string, Record<string, unknown>> = {};
const assignments: Record<string, Record<string, unknown>> = {};

function addUser(key: string, name: string, status = 'active') {
  users[key] = userDoc(name, `${key}@standee.test`, status);
}
function addProduct(
  key: string,
  slug: string,
  name: string,
  kind: string,
  category: string
) {
  products[key] = {
    _id: oid(),
    slug,
    name,
    kind,
    category,
    active: true,
    description: '',
    priceMinor: 10000,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  };
}
function standeeDoc(input: {
  userId: mongoose.Types.ObjectId;
  routeSlug: string;
  name: string;
  googleUrl?: string;
  publicSlug?: string;
  withGoogleSlot?: boolean;
  overrides?: Record<string, unknown>;
}): Record<string, unknown> {
  const panelQrId = `panel-${input.routeSlug}`;
  const googleQrId = `google-${input.routeSlug}`;
  return {
    _id: oid(),
    userId: input.userId,
    name: input.name,
    displayName: input.name,
    routeSlug: input.routeSlug,
    uid: input.routeSlug,
    ...(input.publicSlug ? { publicSlug: input.publicSlug } : {}),
    productKey: 'GOOGLE_REVIEW_STANDEE',
    maxProfiles: 1,
    fixedProfiles: ['google_review'],
    panelQr: { qrId: panelQrId, qrColor: '#000000' },
    socialQrs:
      input.withGoogleSlot === false
        ? []
        : [
            {
              qrId: googleQrId,
              platform: 'google_review',
              qrColor: '#000000',
              label: 'Google Review',
              destinationUrl: input.googleUrl ?? '',
            },
          ],
    ...(input.overrides ? { reviewOverrides: input.overrides } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
function cardDoc(input: {
  userId: mongoose.Types.ObjectId;
  alias: string;
  name: string;
  category: string;
  kind?: 'review' | 'profile';
}): Record<string, unknown> {
  return {
    _id: oid(),
    cardUid: `S46-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    slug: input.alias,
    urlAlias: input.alias,
    name: input.name,
    kind: input.kind ?? 'review',
    userId: input.userId,
    assignedUserId: input.userId,
    status: 'active',
    isActive: true,
    setupComplete: true,
    reviewSettingsSource: 'legacy',
    reviewSettingsVersion: 0,
    reviewAssistant: {
      enabled: true,
      googleReviewUrl: `https://example.test/${input.alias}`,
      writingStyle: 'friendly',
      preferredLength: 'short',
      languages: ['English'],
      feedbackTopics: [],
      welcomeMessage: 'Card welcome',
      category: input.category,
      employees: [],
      services: [],
      keywords: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}
function addAssignment(
  key: string,
  userKey: string,
  productKey: string,
  instance: { cardKey?: string; standeeKey?: string },
  status: 'active' | 'removed' = 'active'
) {
  assignments[key] = {
    _id: oid(),
    userId: users[userKey]._id,
    catalogProductId: products[productKey]._id,
    cardId: instance.cardKey ? cards[instance.cardKey]._id : null,
    standeeId: instance.standeeKey ? standees[instance.standeeKey]._id : null,
    quantity: 1,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

function settingsDoc(
  businessId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    businessId,
    schemaVersion: 1,
    general: {
      enabled: true,
      googleReviewUrl: 'https://example.test/central-standee',
      welcomeMessage: 'Central Standee welcome',
    },
    content: {
      category: 'standee-cat',
      languages: ['English', 'Spanish'],
      writingStyle: 'professional',
      preferredLength: 'medium',
      styleMode: 'fixed',
      lengthMode: 'fixed',
      feedbackTopics: ['Service'],
      services: ['Latte'],
      employees: ['Mira'],
      keywords: ['cosy'],
    },
    updatedBy: businessId,
    createdAt: now,
    updatedAt: now,
    __v: 0,
    ...overrides,
  };
}

async function seed() {
  await connectDB();
  const db = database();
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }
  await Promise.all([
    ReviewSettings.syncIndexes(),
    ReviewRotationEvent.syncIndexes(),
    ReviewRotationState.syncIndexes(),
  ]);

  for (const key of [
    'owner',
    'newowner',
    'removeduser',
    'suspended',
    'cross',
    'cardowner',
    'lowerowner',
    'invalidowner',
    'nourl',
  ]) {
    addUser(key, key);
  }
  users.suspended = userDoc('suspended', 'suspended@standee.test', 'suspended');

  addProduct('standee', 'google-review-standee', 'Google Review Standee', 'standee', 'standee');
  addProduct('business', 'business-nfc-card', 'Business NFC Card', 'profile', 'card');
  addProduct('grc', 'google-review-card', 'Google Review Card', 'review', 'card');

  // Profiles are needed for business name and the legacy google_review fallback.
  const profiles = [
    {
      _id: oid(),
      userId: users.owner._id,
      companyInfo: { companyName: 'Standee Cafe' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      userId: users.newowner._id,
      companyInfo: { companyName: 'New Standee Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      userId: users.removeduser._id,
      companyInfo: { companyName: 'Removed Standee Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      userId: users.cross._id,
      companyInfo: { companyName: 'Cross Standee Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      userId: users.invalidowner._id,
      companyInfo: { companyName: 'Invalid Central Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      userId: users.nourl._id,
      companyInfo: { companyName: 'No URL Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    },
  ];

  standees.ownerStandee = standeeDoc({
    userId: users.owner._id,
    routeSlug: 'standee-owner-1',
    name: 'Standee Cafe',
    googleUrl: 'https://example.test/standee-google',
    publicSlug: 'standee-cafe/standee',
  });
  standees.newStandee = standeeDoc({
    userId: users.newowner._id,
    routeSlug: 'standee-new-1',
    name: 'New Standee Co',
    googleUrl: 'https://example.test/new-standee-google',
    publicSlug: 'new-standee-co/standee',
  });
  standees.removedStandee = standeeDoc({
    userId: users.removeduser._id,
    routeSlug: 'standee-removed-1',
    name: 'Removed Standee Co',
    googleUrl: 'https://example.test/removed-standee-google',
  });
  standees.suspendedStandee = standeeDoc({
    userId: users.suspended._id,
    routeSlug: 'standee-suspended-1',
    name: 'Suspended Standee Co',
    googleUrl: 'https://example.test/suspended-standee-google',
  });
  standees.crossStandee = standeeDoc({
    userId: users.cross._id,
    routeSlug: 'standee-cross-1',
    name: 'Cross Standee Co',
    googleUrl: 'https://example.test/cross-standee-google',
  });
  standees.invalidStandee = standeeDoc({
    userId: users.invalidowner._id,
    routeSlug: 'standee-invalid-1',
    name: 'Invalid Central Co',
    googleUrl: 'https://example.test/invalid-standee-google',
  });
  standees.noUrlStandee = standeeDoc({
    userId: users.nourl._id,
    routeSlug: 'standee-nourl-1',
    name: 'No URL Co',
    withGoogleSlot: false,
  });
  standees.unknownStandee = standeeDoc({
    userId: users.cross._id,
    routeSlug: 'standee-unknown-1',
    name: 'Unknown Product Co',
    googleUrl: 'https://example.test/unknown-standee-google',
  });

  cards.cardReview = cardDoc({
    userId: users.cardowner._id,
    alias: 'standee-cross-card',
    name: 'Standee Cross Card',
    category: 'standee-cat',
  });
  cards.lowerCard = cardDoc({
    userId: users.lowerowner._id,
    alias: 'standee-lower-card',
    name: 'Lower Card',
    category: 'cafe',
    kind: 'profile',
  });
  cards.removedGrc = cardDoc({
    userId: users.removeduser._id,
    alias: 'removed-user-grc',
    name: 'Removed User GRC',
    category: 'cafe',
  });

  addAssignment('ownerStandee', 'owner', 'standee', { standeeKey: 'ownerStandee' });
  addAssignment('newStandee', 'newowner', 'standee', { standeeKey: 'newStandee' });
  addAssignment('removedStandee', 'removeduser', 'standee', { standeeKey: 'removedStandee' }, 'removed');
  addAssignment('removedGrc', 'removeduser', 'grc', { cardKey: 'removedGrc' });
  addAssignment('suspendedStandee', 'suspended', 'standee', { standeeKey: 'suspendedStandee' });
  addAssignment('crossStandee', 'cross', 'standee', { standeeKey: 'crossStandee' });
  addAssignment('invalidStandee', 'invalidowner', 'standee', { standeeKey: 'invalidStandee' });
  addAssignment('noUrlStandee', 'nourl', 'standee', { standeeKey: 'noUrlStandee' });
  addAssignment('unknownStandee', 'cross', 'business', { standeeKey: 'unknownStandee' });
  addAssignment('cardReview', 'cardowner', 'grc', { cardKey: 'cardReview' });
  addAssignment('lowerCard', 'lowerowner', 'business', { cardKey: 'lowerCard' });

  await db.collection('users').insertMany(Object.values(users));
  await db.collection('profiles').insertMany(profiles);
  await db.collection('catalogproducts').insertMany(Object.values(products));
  await db.collection('cards').insertMany(Object.values(cards));
  await db.collection('standees').insertMany(Object.values(standees));
  await db.collection('userproducts').insertMany(Object.values(assignments));

  await db.collection('reviewcategories').insertMany([
    {
      _id: oid(),
      key: 'standee-cat',
      name: 'Standee Category',
      active: true,
      languages: ['English', 'Spanish'],
      scenarios: [
        { key: 'service', name: 'Service' },
        { key: 'quality', name: 'Quality' },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      key: 'cafe',
      name: 'Cafe',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const template = (
    key: string,
    categoryKey: string,
    language: string,
    text: string,
    length: string,
    style: string
  ) => ({
    _id: oid(),
    key,
    categoryKey,
    scenario: 'service',
    language,
    text,
    length,
    style,
    variables: [],
    compatibleKeywords: [],
    active: true,
    usageCount: 0,
    lastShownAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('reviewtemplates').insertMany([
    template('standee-en-short', 'standee-cat', 'English', 'Standee short {businessName}.', 'short', 'friendly'),
    template('standee-en-medium', 'standee-cat', 'English', 'Standee medium {businessName}.', 'medium', 'professional'),
    template('standee-en-detailed', 'standee-cat', 'English', 'Standee detailed {businessName}.', 'detailed', 'casual'),
    template('standee-es-short', 'standee-cat', 'Spanish', 'Standee corto {businessName}.', 'short', 'friendly'),
    template('cafe-en-short', 'cafe', 'English', 'Cafe short {businessName}.', 'short', 'friendly'),
  ]);

  await db.collection('reviewsettings').insertMany([
    settingsDoc(users.owner._id),
    { ...settingsDoc(users.invalidowner._id), schemaVersion: 999 },
  ]);

  const shortTemplate = (await db.collection('reviewtemplates').findOne({
    key: 'cafe-en-short',
  })) as { _id: mongoose.Types.ObjectId };
  await db.collection('reviewrotationevents').insertOne({
    _id: oid(),
    businessId: users.owner._id,
    categoryKey: 'cafe',
    templateId: shortTemplate._id,
    cycle: 0,
    copyId: 'seed-standee-copy',
    cardId: null,
    standeeId: standees.ownerStandee._id,
    copiedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await TenantSettings.create({
    userId: users.owner._id,
    openai: {
      enabled: true,
      apiKeyEnc: encryptSecret('standee-test-key'),
      model: 'gpt-4o-mini',
      dailyLimit: 0,
      usage: {},
    },
  });
}

function tokenFor(user: FixtureUser, expiresIn = '1h') {
  return jwt.sign({ userId: String(user._id), role: user.role }, secret, { expiresIn });
}
let ipCounter = 1;
async function api(
  method: string,
  path: string,
  options: {
    user?: FixtureUser;
    token?: string;
    body?: unknown;
    raw?: string;
    origin?: string | null;
  } = {}
) {
  const headers: Record<string, string> = {
    'x-real-ip': `10.66.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
  };
  const token = options.token ?? (options.user ? tokenFor(options.user) : undefined);
  if (token) headers.cookie = `token=${token}`;
  if (options.body !== undefined || options.raw !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && options.origin !== null) headers.origin = options.origin ?? BASE;
  const res = await fetch(BASE + path, {
    method,
    headers,
    redirect: 'manual',
    ...(options.raw !== undefined
      ? { body: options.raw }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, location: res.headers.get('location') };
}
const UNAVAILABLE = 'Reviews aren’t available right now';

async function main() {
  await seed();

  await check('standee: existing/new active ownership resolves; removed/suspended/unknown/no-URL do not', async () => {
    const owner = await resolveStandeeReviewProduct(standees.ownerStandee as never);
    const created = await resolveStandeeReviewProduct(standees.newStandee as never);
    ok(owner && created, 'active standees did not resolve');
    ok(owner?.googleReviewUrl === 'https://example.test/standee-google', 'standee URL changed');
    const removed = await resolveStandeeReviewProduct(standees.removedStandee as never);
    const suspended = await resolveStandeeReviewProduct(standees.suspendedStandee as never);
    const unknown = await resolveStandeeReviewProduct(standees.unknownStandee as never);
    const nourl = await resolveStandeeReviewProduct(standees.noUrlStandee as never);
    ok(!removed && !suspended && !unknown && !nourl, 'an ineligible standee resolved');
  });
  await check('standee: entitlement is product-level and account-level without lower-tier leakage', async () => {
    const entitlement = await resolveEntitlement(users.owner._id);
    ok(entitlement.capabilities.has('review_ai_suggestions'), 'review capability missing');
    ok(entitlement.productIds.includes('GOOGLE_REVIEW_STANDEE'), 'standee product missing');
    const lower = await resolveEntitlement(users.lowerowner._id);
    ok(!lower.capabilities.has('review_ai_suggestions'), 'lower-tier account gained review capability');
  });
  await check('standee: central-only source strategy fails closed without publication', async () => {
    const host = await resolveStandeeReviewHost('standee-owner-1');
    if (!EXPECT_CENTRAL) {
      ok(host === null, 'gate OFF returned a host');
    } else {
      ok(host, 'central ON did not resolve host');
      ok(host?.config.googleReviewUrl === 'https://example.test/standee-google', 'central URL replaced Standee URL');
      ok(host?.config.category === 'standee-cat', 'central category missing');
      ok(host?.config.writingStyle === 'professional', 'central style missing');
    }
    // This standee has no central settings; it must never fall back to legacy
    // publication.
    const fresh = await resolveStandeeReviewHost('standee-new-1');
    ok(fresh === null, 'standee without central settings published');
  });
  await check('standee: invalid central settings fail closed', async () => {
    if (!EXPECT_STANDEE) return;
    const host = await resolveStandeeReviewHost('standee-invalid-1');
    ok(host === null, 'invalid central settings published the standee host');
  });

  // ── Public redirects ──────────────────────────────────────────────────
  await check('redirects: without central publication the exact Google destination is preserved', async () => {
    if (EXPECT_CENTRAL) return;
    const panel = await api('GET', '/r/standee-owner-1');
    const slot = await api('GET', '/r/standee-owner-1/1');
    const social = await api('GET', '/qr/google-standee-owner-1');
    const panelQr = await api('GET', '/qr/panel-standee-owner-1');
    ok(panel.status === 307 && panel.location === 'https://example.test/standee-google', `panel ${panel.status} ${panel.location}`);
    ok(slot.status === 307 && slot.location === 'https://example.test/standee-google', `slot ${slot.status} ${slot.location}`);
    ok(social.status === 302 && social.location === 'https://example.test/standee-google', `social ${social.status} ${social.location}`);
    ok(panelQr.status === 307 && panelQr.location?.includes('/panel/standee-owner-1'), `panel QR ${panelQr.status} ${panelQr.location}`);
    const host = await api('GET', '/standee-review/standee-owner-1');
    ok(host.status === 200 && host.text.includes(UNAVAILABLE), 'gate OFF host was not unavailable');
  });
  await check('redirects: central publication routes existing QR/NFC URLs to the Standee host', async () => {
    if (!EXPECT_CENTRAL) return;
    for (const [path, label] of [
      ['/r/standee-owner-1', 'panel'],
      ['/r/standee-owner-1/1', 'slot'],
      ['/qr/google-standee-owner-1', 'social QR'],
      ['/qr/panel-standee-owner-1', 'panel QR'],
    ] as const) {
      const res = await api('GET', path);
      ok(res.status === 307, `${label} status ${res.status}`);
      ok(res.location?.includes('/standee-review/standee-owner-1'), `${label} location ${res.location}`);
    }
    const page = await api('GET', '/standee-review/standee-owner-1');
    ok(page.status === 200 && !page.text.includes(UNAVAILABLE), 'host unavailable');
    ok(page.text.includes('Standee Cafe'), 'business name missing');
    const created = await api('GET', '/standee-review/standee-new-1');
    ok(created.status === 200 && created.text.includes(UNAVAILABLE), 'standee without central settings published');
    for (const slug of ['standee-removed-1', 'standee-suspended-1', 'standee-unknown-1', 'standee-nourl-1']) {
      const res = await api('GET', `/standee-review/${slug}`);
      ok(res.status === 200 && res.text.includes(UNAVAILABLE), `${slug} was not blocked`);
    }
    const human = await api('GET', '/standee-cafe/standee');
    ok(human.status === 200, `human standee URL ${human.status}`);
  });
  await check('redirects: ineligible standees keep the old destination when central is ON', async () => {
    if (!EXPECT_CENTRAL) return;
    const removed = await api('GET', '/r/standee-removed-1');
    ok(
      removed.status === 307 && removed.location === 'https://example.test/removed-standee-google',
      `removed ${removed.status} ${removed.location}`
    );
    const suspended = await api('GET', '/r/standee-suspended-1');
    ok(
      suspended.status === 307 && suspended.location === 'https://example.test/suspended-standee-google',
      `suspended ${suspended.status} ${suspended.location}`
    );
  });

  // ── Public APIs ───────────────────────────────────────────────────────
  let standeeTemplateId = '';
  await check('public API: suggestions respect the gate and settings source', async () => {
    if (!EXPECT_CENTRAL) {
      const res = await api('POST', '/api/public/standee-reviews/standee-owner-1/suggestions', {
        body: { language: 'English', length: 'short' },
      });
      ok(res.status === 404, `central OFF suggestions ${res.status}`);
      return;
    }
    const res = await api('POST', '/api/public/standee-reviews/standee-owner-1/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(res.status === 200, `suggestions ${res.status}`);
    const body = res.json as { mode?: string; suggestions?: Array<{ templateId?: string }> };
    if (EXPECT_CENTRAL) {
      ok(body.mode === 'template' && body.suggestions?.length, 'central suggestions missing');
      standeeTemplateId = body.suggestions?.[0]?.templateId ?? '';
      ok(standeeTemplateId, 'template id missing');
    } else {
      ok(body.mode === 'none', 'central category leaked while gate OFF');
    }
    const fresh = await api('POST', '/api/public/standee-reviews/standee-new-1/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(fresh.status === 404, `standee without central suggestions ${fresh.status}`);
    const unknown = await api('POST', '/api/public/standee-reviews/not-a-standee/suggestions', {
      body: { language: 'English' },
    });
    ok(unknown.status === 404, `unknown suggestions ${unknown.status}`);
  });
  await check('public API: invalid JSON, oversized and prototype payloads are rejected', async () => {
    if (!EXPECT_STANDEE) return;
    const paths = [
      ['/api/public/standee-reviews/standee-owner-1/suggestions', '{'],
      ['/api/public/standee-reviews/standee-owner-1/copied', '{"__proto__":{"polluted":true}}'],
    ] as const;
    for (const [path, raw] of paths) {
      const res = await api('POST', path, { raw });
      ok(res.status === 400, `${path} ${res.status}`);
    }
    const oversized = await api('POST', '/api/public/standee-reviews/standee-owner-1/suggestions', {
      raw: JSON.stringify({ feedback: 'x'.repeat(70_000) }),
    });
    ok(oversized.status === 413, `oversized ${oversized.status}`);
  });
  await check('public API: copy records Standee attribution and is idempotent', async () => {
    if (!EXPECT_STANDEE || !EXPECT_CENTRAL || EXPECT_ROTATION) return;
    const db = database();
    const before = await db.collection('reviewrotationevents').countDocuments({
      standeeId: standees.ownerStandee._id,
    });
    const copyId = `standee-copy-${Date.now()}`;
    const first = await api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
      body: { templateId: standeeTemplateId, copyId },
    });
    ok([200, 201].includes(first.status), `first copy ${first.status}`);
    const replay = await api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
      body: { templateId: standeeTemplateId, copyId },
    });
    ok(replay.status === 200, `replay ${replay.status}`);
    const after = await db.collection('reviewrotationevents').countDocuments({
      standeeId: standees.ownerStandee._id,
    });
    ok(after === before + 1, `event count ${before} -> ${after}`);
    const event = (await db.collection('reviewrotationevents').findOne({ copyId })) as
      | { cardId?: unknown; standeeId?: unknown }
      | null;
    ok(event && !event.cardId && String(event.standeeId) === String(standees.ownerStandee._id), 'event attribution wrong');
  });
  await check('public API: rotation mode requires and validates a Standee token', async () => {
    if (!EXPECT_STANDEE || !EXPECT_CENTRAL || !EXPECT_ROTATION) return;
    const suggestions = await api('POST', '/api/public/standee-reviews/standee-owner-1/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    const item = (suggestions.json as { suggestions?: Array<{ templateId?: string; rotationToken?: string }> })
      .suggestions?.[0];
    ok(item?.rotationToken && item.templateId, 'rotation token missing');
    const noToken = await api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
      body: { templateId: item!.templateId, copyId: `rot-no-${Date.now()}` },
    });
    ok(noToken.status === 409, `no token ${noToken.status}`);
    const copyId = `rot-${Date.now()}`;
    const withToken = await api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
      body: { templateId: item!.templateId, rotationToken: item!.rotationToken, copyId },
    });
    ok([200, 201].includes(withToken.status), `valid token ${withToken.status}`);
    const replay = await api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
      body: { templateId: item!.templateId, rotationToken: item!.rotationToken, copyId },
    });
    ok(replay.status === 200, `replay ${replay.status}`);
    const event = (await database().collection('reviewrotationevents').findOne({ copyId })) as
      | { cardId?: unknown; standeeId?: unknown }
      | null;
    ok(
      event && !event.cardId && String(event.standeeId) === String(standees.ownerStandee._id),
      'rotation copy attribution wrong'
    );
    // Cross-host replay on a Card must be rejected.
    const crossHost = await api('POST', '/api/public/reviews/standee-cross-card/copied', {
      body: { templateId: item!.templateId, rotationToken: item!.rotationToken, copyId: `cross-${Date.now()}` },
    });
    ok(crossHost.status === 409, `cross-host token accepted ${crossHost.status}`);
  });
  await check('public API: concurrent same-copyId requests create one event', async () => {
    if (!EXPECT_STANDEE || !EXPECT_CENTRAL) return;
    const db = database();
    const before = await db.collection('reviewrotationevents').countDocuments({ copyId: /^parallel-standee-/ });
    const suggestions = await api('POST', '/api/public/standee-reviews/standee-owner-1/suggestions', {
      body: { language: 'English', length: 'medium' },
    });
    const fresh = (suggestions.json as {
      suggestions?: Array<{ templateId?: string; rotationToken?: string }>;
    }).suggestions?.[0];
    const freshTemplateId = fresh?.templateId;
    const freshToken = fresh?.rotationToken;
    ok(freshTemplateId, 'fresh template missing');
    if (EXPECT_ROTATION) ok(freshToken, 'fresh rotation token missing');
    const copyId = `parallel-standee-${Date.now()}`;
    const [a, b] = await Promise.all([
      api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
        body: {
          templateId: freshTemplateId,
          copyId,
          ...(EXPECT_ROTATION ? { rotationToken: freshToken } : {}),
        },
      }),
      api('POST', '/api/public/standee-reviews/standee-owner-1/copied', {
        body: {
          templateId: freshTemplateId,
          copyId,
          ...(EXPECT_ROTATION ? { rotationToken: freshToken } : {}),
        },
      }),
    ]);
    ok([a.status, b.status].some((status) => status === 200 || status === 201), 'no successful copy');
    const after = await db.collection('reviewrotationevents').countDocuments({ copyId: /^parallel-standee-/ });
    ok(after === before + 1, `parallel event count ${before} -> ${after}`);
  });

  // ── Management ────────────────────────────────────────────────────────
  await check('management: product list includes the Standee and excludes removed/lower products', async () => {
    const owner = await api('GET', '/api/review-management/products', { user: users.owner });
    ok(owner.status === 200, `owner products ${owner.status}`);
    const rows = (owner.json as { products?: Array<Record<string, unknown>> }).products ?? [];
    const standee = rows.find((row) => String(row.standeeId) === String(standees.ownerStandee._id));
    ok(standee, 'standee missing from product list');
    ok(standee.instanceType === 'standee', 'instance type wrong');
    ok(standee.hostingEnabled === EXPECT_STANDEE, 'hostingEnabled mismatch');
    ok(String(standee.previewUrl) === '/standee-review/standee-owner-1', 'preview URL wrong');
    ok(standee.standeeGoogleReviewUrl === 'https://example.test/standee-google', 'standee URL missing');

    const removed = await api('GET', '/api/review-management/products', { user: users.removeduser });
    ok(removed.status === 200, `removed products ${removed.status}`);
    const removedRows = (removed.json as { products?: Array<Record<string, unknown>> }).products ?? [];
    ok(
      !removedRows.some((row) => String(row.standeeId) === String(standees.removedStandee._id)),
      'removed standee listed'
    );
    const lower = await api('GET', '/api/review-management/products', { user: users.lowerowner });
    ok(lower.status === 403 || ((lower.json as { products?: unknown[] }).products ?? []).length === 0, 'lower got review products');
  });
  await check('management: preview preserves the Standee Google URL and effective source', async () => {
    const res = await api(
      'GET',
      `/api/review-management/preview?assignmentId=${assignments.ownerStandee._id}`,
      { user: users.owner }
    );
    ok(res.status === 200, `preview ${res.status}`);
    const body = res.json as {
      instanceType?: string;
      hostingEnabled?: boolean;
      settings?: { googleReviewUrl?: string; category?: string; writingStyle?: string };
      source?: string;
    };
    ok(body.instanceType === 'standee', 'preview instance type wrong');
    ok(body.hostingEnabled === EXPECT_STANDEE, 'preview hosting flag wrong');
    ok(body.settings?.googleReviewUrl === 'https://example.test/standee-google', 'preview replaced Standee URL');
    // Management preview shows the configured central source regardless of the
    // public integration gate (matching Card preview behavior). The public host
    // itself still honors the gate.
    ok(body.settings?.category === 'standee-cat', 'central category missing');
    ok(body.settings?.writingStyle === 'professional', 'central style missing');
  });
  await check('management: central connect and destination-only update preserve the slot', async () => {
    const saved = await api('PATCH', '/api/review-management', {
      user: users.newowner,
      body: {
        general: {
          enabled: true,
          googleReviewUrl: 'https://example.test/new-central-url',
          welcomeMessage: 'New central welcome',
        },
        content: {
          category: 'standee-cat',
          languages: ['English'],
          writingStyle: 'professional',
          preferredLength: 'medium',
          styleMode: 'fixed',
          lengthMode: 'fixed',
        },
      },
    });
    ok(saved.status === 200, `save central ${saved.status}`);
    const before = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    const central = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, body: { source: 'central', revision: 0 } }
    );
    ok(central.status === 200, `central ${central.status}: ${central.text}`);
    const afterCentral = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    ok(afterCentral.reviewSettingsSource === 'central', 'source not central');
    ok(
      JSON.stringify(afterCentral.socialQrs) === JSON.stringify(before.socialQrs),
      'standee destinations changed by central connect'
    );
    ok(afterCentral.publicSlug === before.publicSlug, 'public slug changed');

    const previewCentral = await api(
      'GET',
      `/api/review-management/preview?assignmentId=${assignments.newStandee._id}`,
      { user: users.newowner }
    );
    const centralBody = previewCentral.json as {
      published?: boolean;
      settings?: { googleReviewUrl?: string; category?: string; writingStyle?: string };
    };
    ok(centralBody.published === EXPECT_CENTRAL, `central published ${centralBody.published}`);
    ok(centralBody.settings?.googleReviewUrl === 'https://example.test/new-standee-google', 'central URL replaced Standee URL');
    ok(centralBody.settings?.category === 'standee-cat', 'central category missing');
    ok(centralBody.settings?.writingStyle === 'professional', 'central style missing');

    const destination = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      {
        user: users.newowner,
        body: {
          source: 'destination',
          revision: 1,
          destination: { googleReviewUrl: 'https://example.test/new-hybrid-url' },
        },
      }
    );
    ok(destination.status === 200, `destination ${destination.status}: ${destination.text}`);
    const afterDestination = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    ok(afterDestination.reviewSettingsSource === 'central', 'destination changed source');
    const previewDestination = await api(
      'GET',
      `/api/review-management/preview?assignmentId=${assignments.newStandee._id}`,
      { user: users.newowner }
    );
    const destinationSettings = (previewDestination.json as { settings?: Record<string, unknown> }).settings;
    ok(destinationSettings?.googleReviewUrl === 'https://example.test/new-hybrid-url', 'destination not saved');
    ok(destinationSettings?.styleMode === 'fixed', 'destination changed central content');

    const hybrid = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      {
        user: users.newowner,
        body: {
          source: 'hybrid',
          revision: 2,
          overrides: { enabled: true, keywords: ['standee'] },
        },
      }
    );
    ok(hybrid.status === 400, `hybrid content ${hybrid.status}: ${hybrid.text}`);

    const legacy = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, body: { source: 'legacy', revision: 2 } }
    );
    ok(legacy.status === 400, `legacy ${legacy.status}`);
    const afterLegacy = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    ok(afterLegacy.reviewSettingsSource === 'central', 'legacy rejected but source changed');
    ok(
      JSON.stringify(afterLegacy.socialQrs) === JSON.stringify(afterDestination.socialQrs),
      'rejected legacy changed standee destinations'
    );
  });
  await check('management: stale revision, parallel connection and security boundaries', async () => {
    const stale = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, body: { source: 'central', revision: 0 } }
    );
    ok(stale.status === 409, `stale ${stale.status}`);
    const current = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    const currentRevision =
      typeof current.reviewSettingsVersion === 'number' ? current.reviewSettingsVersion : 0;
    const [a, b] = await Promise.all([
      api('PATCH', `/api/review-management/products/${assignments.newStandee._id}`, {
        user: users.newowner,
        body: {
          source: 'destination',
          revision: currentRevision,
          destination: { googleReviewUrl: 'https://example.test/parallel-a' },
        },
      }),
      api('PATCH', `/api/review-management/products/${assignments.newStandee._id}`, {
        user: users.newowner,
        body: {
          source: 'destination',
          revision: currentRevision,
          destination: { googleReviewUrl: 'https://example.test/parallel-b' },
        },
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    ok(statuses[0] === 200 && statuses[1] === 409, `parallel statuses ${statuses.join(',')}`);
    const card = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    ok(card.reviewSettingsVersion === currentRevision + 1, `version ${card.reviewSettingsVersion}`);

    const unauth = await api('PATCH', `/api/review-management/products/${assignments.newStandee._id}`, {
      body: { source: 'central' },
    });
    ok(unauth.status === 401, `unauth ${unauth.status}`);
    const cross = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.cross, body: { source: 'central' } }
    );
    ok(cross.status === 404, `cross ${cross.status}`);
    const lower = await api(
      'PATCH',
      `/api/review-management/products/${assignments.lowerCard._id}`,
      { user: users.lowerowner, body: { source: 'central' } }
    );
    ok(lower.status === 403, `lower ${lower.status}`);
    const removed = await api(
      'PATCH',
      `/api/review-management/products/${assignments.removedStandee._id}`,
      { user: users.removeduser, body: { source: 'central' } }
    );
    ok(removed.status === 404, `removed ${removed.status}`);
    const noUrl = await api(
      'PATCH',
      `/api/review-management/products/${assignments.noUrlStandee._id}`,
      { user: users.nourl, body: { source: 'central' } }
    );
    ok(noUrl.status === 400 || noUrl.status === 404, `no URL ${noUrl.status}`);
    const csrf = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, origin: null, body: { source: 'central' } }
    );
    ok(csrf.status === 403, `csrf ${csrf.status}`);
    const oversized = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, body: { source: 'central', padding: 'x'.repeat(70_000) } }
    );
    ok(oversized.status === 413, `oversized ${oversized.status}`);
    const proto = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      { user: users.newowner, raw: '{"source":"central","__proto__":{"polluted":true}}' }
    );
    ok(proto.status === 400, `prototype ${proto.status}`);
  });
  await check('management: unknown override keys survive Standee updates', async () => {
    const db = database();
    await db.collection('standees').updateOne(
      { _id: new mongoose.Types.ObjectId(String(standees.newStandee._id)) },
      { $set: { 'reviewOverrides.legacyCustomField': 'keep-standee' } }
    );
    const standeeBefore = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    const revision =
      typeof standeeBefore.reviewSettingsVersion === 'number'
        ? standeeBefore.reviewSettingsVersion
        : 0;
    const res = await api(
      'PATCH',
      `/api/review-management/products/${assignments.newStandee._id}`,
      {
        user: users.newowner,
        body: {
          source: 'destination',
          revision,
          destination: { googleReviewUrl: 'https://example.test/kept-standee-destination' },
        },
      }
    );
    ok(res.status === 200, `destination update ${res.status}`);
    const standee = (await Standee.findById(standees.newStandee._id).lean()) as Record<string, unknown>;
    const overrides = standee.reviewOverrides as Record<string, unknown>;
    ok(overrides.legacyCustomField === 'keep-standee', 'unknown override deleted');
  });

  // ── AI orchestration (direct service, injected completion) ────────────
  await check('AI: Standee generation uses effective style/length and Standee attribution', async () => {
    if (!EXPECT_STANDEE || !EXPECT_CENTRAL) return;
    const host = await resolveStandeeReviewHost('standee-owner-1');
    ok(host, 'host missing');
    let captured: { system?: string } = {};
    const result = await generateReviewForHost({
      ownerId: host!.ownerId,
      hostType: 'standee',
      hostId: host!.standeeId,
      config: host!.config,
      feedback: 'The coffee was excellent and the staff were very kind.',
      topics: [],
      ip: '10.66.1.1',
      userAgent: 'test',
      now: new Date(0),
      complet: async (input: { system: string }) => {
        captured = input;
        return { text: 'Generated standee review', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    });
    ok(result.ok, 'generation failed');
    if (EXPECT_CENTRAL) {
      ok(captured.system?.includes('professional'), 'central style missing from prompt');
      ok(captured.system?.includes('medium (4-6 sentences)'), 'central length missing from prompt');
    } else {
      ok(captured.system?.includes('friendly'), 'legacy style missing from prompt');
    }
    const event = await AnalyticsLog.findOne({
      action: 'review_generated',
      standeeId: new Types.ObjectId(String(host!.standeeId)),
    }).lean();
    ok(event, 'standee generation analytics missing');
  });
  await check('backward compatibility: existing Cards remain unchanged', async () => {
    const page = await api('GET', '/review/standee-cross-card');
    ok(page.status === 200 && page.text.includes(UNAVAILABLE), 'Card review page published without central');
    const lower = await api('GET', '/review/standee-lower-card');
    ok(lower.status === 200 && lower.text.includes(UNAVAILABLE), 'lower Card lost restriction');
    const card = (await Card.findById(cards.cardReview._id).lean()) as Record<string, unknown>;
    ok((card.reviewAssistant as { enabled?: boolean } | undefined)?.enabled === true, 'Card reviewAssistant changed');
    ok(card.urlAlias === 'standee-cross-card', 'Card alias changed');
  });
  await check('backward compatibility: templates and rotation history survive Standee connections', async () => {
    const templates = await ReviewTemplate.countDocuments({});
    ok(templates === 5, `template count ${templates}`);
    const ownerEvents = await ReviewRotationEvent.countDocuments({
      businessId: users.owner._id,
    });
    ok(ownerEvents >= 1, 'seed rotation event missing');
    const seed = (await ReviewRotationEvent.findOne({ copyId: 'seed-standee-copy' }).lean()) as {
      standeeId?: unknown;
    } | null;
    ok(seed && seed.standeeId, 'historical standee event unreadable');
  });

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} checks passed (standee=${EXPECT_STANDEE} central=${EXPECT_CENTRAL} rotation=${EXPECT_ROTATION})`);
  if (passed !== results.length) {
    for (const result of results.filter((item) => !item.ok)) {
      console.log(`- ${result.name}: ${result.detail}`);
    }
  }
  await mongoose.disconnect();
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
