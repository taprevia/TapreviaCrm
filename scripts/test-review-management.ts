/**
 * Phase 4D.5 Review Management regression suite.
 *
 * Runs against a disposable local MongoDB and a locally running Next server.
 * It seeds its own fixtures, then exercises the real HTTP APIs and the real
 * entitlement/resolver services. It refuses to run against a non-local base URL
 * or a database without the `taprevia_4d5_` prefix.
 *
 * Usage:
 *   MONGODB_URI=mongodb://localhost:27017 \
 *   MONGODB_DB=taprevia_4d5_suite \
 *   TEST_BASE=http://localhost:3501 \
 *   EXPECT_GATE=false \
 *   npx tsx scripts/test-review-management.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import type { IReviewAssistantConfig } from '@/types';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import ReviewSettings from '@/models/ReviewSettings';
import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import ReviewRotationState from '@/models/ReviewRotationState';
import { connectDB } from '@/lib/db';
import { resolveEntitlement } from '@/lib/services/capability-access';
import {
  getCardReviewEntitlement,
} from '@/lib/services/review-entitlement';
import {
  normalizeReviewOverrides,
  resolveReviewSettings,
} from '@/lib/services/review-settings-resolver';
import { getProductCapabilities } from '@/config/products';

const require = createRequire('/Users/prince/Documents/CRM/package.json');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE ?? 'http://localhost:3501';
const EXPECT_GATE = process.env.EXPECT_GATE === 'true';
const DB_NAME = process.env.MONGODB_DB ?? '';
const ISOLATED = DB_NAME.startsWith('taprevia_4d5_');
const LOCAL_BASE = ['localhost', '127.0.0.1'].includes(new URL(BASE).hostname);

if (!ISOLATED) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_4d5_ (got "${DB_NAME}")`);
  process.exit(2);
}
if (!LOCAL_BASE) {
  console.error(`Refusing to run against non-local TEST_BASE: ${BASE}`);
  process.exit(2);
}

const secret = (() => {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = fs.readFileSync('/Users/prince/Documents/CRM/.env.local', 'utf8');
  const match = /^JWT_SECRET=(.*)$/m.exec(file);
  if (!match) throw new Error('JWT_SECRET not available');
  return match[1].trim().replace(/^"|"$/g, '');
})();

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
function database(): NonNullable<typeof mongoose.connection.db> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready');
  return db;
}
const now = new Date();
let ipCounter = 1;

interface SeedUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  role: string;
  status: string;
}

function userDoc(name: string, email: string): SeedUser & Record<string, unknown> {
  return {
    _id: oid(),
    name,
    email,
    role: 'customer',
    status: 'active',
    passwordHash: 'x'.repeat(32),
    createdAt: now,
    updatedAt: now,
  };
}

function cardDoc(input: {
  name: string;
  alias: string;
  userId: mongoose.Types.ObjectId;
  kind?: 'profile' | 'social' | 'review';
  enabled?: boolean;
  isActive?: boolean;
  source?: 'legacy' | 'central' | 'hybrid';
  version?: number;
  overrides?: Record<string, unknown>;
  review?: Partial<IReviewAssistantConfig>;
}): Record<string, unknown> {
  return {
    _id: oid(),
    cardUid: `P45-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    slug: input.alias || `p45-${Math.random().toString(36).slice(2, 10)}`,
    urlAlias: input.alias,
    name: input.name,
    kind: input.kind ?? 'profile',
    userId: input.userId,
    assignedUserId: input.userId,
    status: 'active',
    isActive: input.isActive ?? true,
    setupComplete: true,
    reviewSettingsSource: input.source ?? 'legacy',
    reviewSettingsVersion: input.version ?? 0,
    ...(input.overrides ? { reviewOverrides: input.overrides } : {}),
    reviewAssistant: {
      enabled: input.enabled ?? true,
      googleReviewUrl: 'https://example.test/legacy-' + (input.alias || 'card'),
      writingStyle: 'professional',
      preferredLength: 'detailed',
      languages: ['English', 'Spanish'],
      feedbackTopics: ['Service'],
      welcomeMessage: 'Legacy welcome',
      category: 'cafe',
      employees: ['Asha'],
      services: ['Espresso'],
      keywords: ['cosy'],
      ...(input.review ?? {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

const users: Record<string, SeedUser> = {};
const products: Record<string, Record<string, unknown>> = {};
const cards: Record<string, Record<string, unknown>> = {};
const assignments: Record<string, Record<string, unknown>> = {};

function addUser(key: string, name: string) {
  users[key] = userDoc(name, `${key}@example.test`);
}
function addProduct(
  key: string,
  slug: string,
  name: string,
  kind: string,
  category: string,
  active = true
) {
  products[key] = {
    _id: oid(),
    slug,
    name,
    kind,
    category,
    active,
    description: '',
    priceMinor: 10000,
    sortOrder: 1,
    createdAt: now,
    updatedAt: now,
  };
}
function addCard(key: string, input: Parameters<typeof cardDoc>[0]) {
  cards[key] = cardDoc(input);
  return cards[key];
}
function addAssignment(
  key: string,
  userKey: string,
  productKey: string,
  cardKey?: string,
  status: 'active' | 'removed' = 'active',
  extra: Record<string, unknown> = {}
) {
  assignments[key] = {
    _id: oid(),
    userId: users[userKey]._id,
    catalogProductId: products[productKey]._id,
    cardId: cardKey ? cards[cardKey]._id : null,
    quantity: 1,
    status,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  return assignments[key];
}

function centralSettings(
  businessId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    businessId,
    schemaVersion: 1,
    general: {
      enabled: true,
      googleReviewUrl: 'https://example.test/central',
      welcomeMessage: 'Central welcome',
    },
    content: {
      category: 'cafe',
      languages: ['English', 'Spanish'],
      writingStyle: 'friendly',
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
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const collection of collections) {
    if (!collection.name.startsWith('system.')) {
      await db.collection(collection.name).deleteMany({});
    }
  }

  // Index definitions under test (disposable DB only).
  await Promise.all([
    ReviewSettings.syncIndexes(),
    ReviewRotationEvent.syncIndexes(),
    ReviewRotationState.syncIndexes(),
  ]);

  for (const key of [
    'premium',
    'lower',
    'mixed',
    'legacyreview',
    'zeroenabled',
    'zerodisabled',
    'removed',
    'inactive',
    'central',
    'hybrid',
    'fallback',
    'invalidcentral',
    'apiuser',
    'catowner',
    'langowner',
    'standeeuser',
    'cross',
    'connector',
    'parallel',
    'hybridparallel',
    'inactivecat',
    'oldlang',
    'para',
    'basicuser',
  ]) {
    addUser(key, key.replace(/^\w/, (c) => c.toUpperCase()));
  }

  addProduct('premium', 'premium-nfc-card', 'Premium NFC Card', 'profile', 'card');
  addProduct('business', 'business-nfc-card', 'Premium NFC Card', 'profile', 'card');
  addProduct('grc', 'google-review-card', 'Google Review Card', 'review', 'card');
  addProduct('plate', 'google-review-nfc-plate', 'Google Review NFC Plate', 'review', 'card');
  addProduct('standee', 'google-review-standee', 'Google Review Standee', 'standee', 'standee');
  // Deliberately unknown catalog slug with a Premium-looking display name.
  addProduct('publicslug', 'premium-public-slug', 'Premium NFC Card', 'profile', 'card');
  // Historical Premium identity: some pre-Phase-2 catalog rows used the public
  // path as their catalog slug. Read-time identity must recognize it.
  addProduct('legacyslug', 'premium-card', 'Premium NFC Card', 'profile', 'card');
  addProduct('unknown', 'mystery-product', 'Mystery Product', 'profile', 'card');
  addProduct('inactiveproduct', 'inactive-review-product', 'Inactive Review Product', 'review', 'card', false);

  addCard('premiumCard', { name: 'Premium Review', alias: 'premium-review', userId: users.premium._id });
  addCard('premiumNew', { name: 'Premium New', alias: 'premium-new', userId: users.premium._id });
  addCard('ownerAssigned', { name: 'Owner Assigned', alias: 'owner-assigned', userId: users.zeroenabled._id });
  addCard('disabledOwnerAssigned', {
    name: 'Disabled Owner Assigned',
    alias: 'disabled-owner-assigned',
    userId: users.zerodisabled._id,
  });
  addCard('zeroEnabled', {
    name: 'Zero Enabled',
    alias: 'zero-profile-enabled',
    userId: users.zeroenabled._id,
    enabled: true,
  });
  addCard('zeroDisabled', {
    name: 'Zero Disabled',
    alias: 'zero-profile-disabled',
    userId: users.zerodisabled._id,
    enabled: false,
  });
  addCard('zeroReview', {
    name: 'Zero Review Host',
    alias: 'zero-review-host',
    userId: users.legacyreview._id,
    kind: 'review',
    enabled: true,
  });
  addCard('lowerCard', { name: 'Lower Review', alias: 'lower-review', userId: users.lower._id });
  addCard('mixedPremium', { name: 'Mixed Premium', alias: 'mixed-premium-review', userId: users.mixed._id });
  addCard('mixedLower', { name: 'Mixed Lower', alias: 'mixed-lower-review', userId: users.mixed._id });
  addCard('grcCard', {
    name: 'GRC Review',
    alias: 'grc-review',
    userId: users.legacyreview._id,
    kind: 'review',
  });
  addCard('plateCard', {
    name: 'Plate Review',
    alias: 'plate-review',
    userId: users.legacyreview._id,
    kind: 'review',
    review: { category: 'cafe' },
  });
  addCard('removedCard', { name: 'Removed Review', alias: 'removed-review', userId: users.removed._id });
  addCard('inactiveCard', {
    name: 'Inactive Review',
    alias: 'inactive-review',
    userId: users.inactive._id,
    isActive: false,
  });
  addCard('centralCard', {
    name: 'Central Review',
    alias: 'central-review',
    userId: users.central._id,
    source: 'central',
    enabled: false,
  });
  addCard('hybridCard', {
    name: 'Hybrid Review',
    alias: 'hybrid-review',
    userId: users.hybrid._id,
    source: 'hybrid',
    enabled: false,
    overrides: {
      enabled: true,
      googleReviewUrl: 'https://example.test/hybrid-override',
      writingStyle: 'casual',
      styleMode: 'varied',
      lengthMode: 'fixed',
    },
  });
  addCard('fallbackCard', {
    name: 'Fallback Review',
    alias: 'fallback-review',
    userId: users.fallback._id,
    source: 'central',
    enabled: true,
  });
  addCard('invalidCentralCard', {
    name: 'Invalid Central Review',
    alias: 'invalid-central-review',
    userId: users.invalidcentral._id,
    source: 'central',
    enabled: true,
  });
  addCard('apiCard', { name: 'API Review', alias: 'api-review', userId: users.apiuser._id });
  addCard('connectorCard', {
    name: 'Connector Review',
    alias: 'connector-review',
    userId: users.connector._id,
  });
  addCard('parallelCard', {
    name: 'Parallel Review',
    alias: 'parallel-review',
    userId: users.parallel._id,
    enabled: false,
  });
  addCard('paraCard', {
    name: 'Settings Concurrency Review',
    alias: 'settings-concurrency-review',
    userId: users.para._id,
  });
  addCard('basicCard', {
    name: 'Basic Business Card',
    alias: 'basic-business-review',
    userId: users.basicuser._id,
  });
  addCard('hybridParallelCard', {
    name: 'Hybrid Parallel Review',
    alias: 'hybrid-parallel-review',
    userId: users.hybridparallel._id,
    enabled: false,
  });
  addCard('catCard', {
    name: 'Inactive Category Review',
    alias: 'inactive-cat-review',
    userId: users.inactivecat._id,
    source: 'hybrid',
    overrides: { category: 'old-cat' },
  });
  addCard('langCard', {
    name: 'Legacy Language Review',
    alias: 'legacy-language-review',
    userId: users.oldlang._id,
    source: 'hybrid',
    overrides: { languages: ['Klingon'] },
  });
  addCard('mislabeledCard', {
    name: 'Mislabeled Premium',
    alias: 'mislabeled-premium',
    userId: users.cross._id,
  });
  addCard('publicSlugCard', {
    name: 'Public Slug Premium',
    alias: 'public-slug-premium',
    userId: users.cross._id,
  });
  addCard('legacySlugCard', {
    name: 'Legacy Slug Premium',
    alias: 'legacy-slug-premium',
    userId: users.cross._id,
  });
  addCard('unknownCard', {
    name: 'Unknown Product',
    alias: 'unknown-product',
    userId: users.cross._id,
  });
  addCard('crossCard', { name: 'Cross Review', alias: 'cross-review', userId: users.cross._id });
  addCard('unaliasedCard', { name: 'No Alias', alias: '', userId: users.apiuser._id });
  addCard('noIdentifierCard', { name: 'No Public Identifier', alias: '', userId: users.apiuser._id });
  // A historical card must expose at least one resolvable public identifier
  // (urlAlias or the legacy printed slug) before it can host reviews.
  cards.noIdentifierCard.slug = '';

  addAssignment('premiumProduct', 'premium', 'premium', 'premiumCard');
  addAssignment('premiumNewProduct', 'premium', 'premium', 'premiumNew');
  addAssignment('premiumGRC', 'premium', 'grc');
  addAssignment('premiumPlate', 'premium', 'plate');
  addAssignment('premiumStandee', 'premium', 'standee');
  addAssignment('ownerAssignedProduct', 'zeroenabled', 'premium', 'ownerAssigned');
  addAssignment('disabledOwnerAssignedProduct', 'zerodisabled', 'premium', 'disabledOwnerAssigned');
  addAssignment('lowerProduct', 'lower', 'business', 'lowerCard');
  addAssignment('lowerGRC', 'lower', 'grc');
  addAssignment('mixedPremiumProduct', 'mixed', 'premium', 'mixedPremium');
  addAssignment('mixedLowerProduct', 'mixed', 'business', 'mixedLower');
  addAssignment('legacyGRC', 'legacyreview', 'grc', 'grcCard');
  addAssignment('legacyPlate', 'legacyreview', 'plate', 'plateCard');
  addAssignment('removedProduct', 'removed', 'premium', 'removedCard', 'removed');
  addAssignment('removedGRC', 'removed', 'grc');
  addAssignment('inactiveProduct', 'inactive', 'premium', 'inactiveCard');
  addAssignment('centralProduct', 'central', 'premium', 'centralCard');
  addAssignment('hybridProduct', 'hybrid', 'premium', 'hybridCard');
  addAssignment('fallbackProduct', 'fallback', 'premium', 'fallbackCard');
  addAssignment('invalidCentralProduct', 'invalidcentral', 'premium', 'invalidCentralCard');
  addAssignment('apiProduct', 'apiuser', 'premium', 'apiCard');
  addAssignment('apiUnaliased', 'apiuser', 'premium', 'unaliasedCard');
  addAssignment('apiNoIdentifier', 'apiuser', 'premium', 'noIdentifierCard');
  addAssignment('connectorProduct', 'connector', 'premium', 'connectorCard');
  addAssignment('parallelProduct', 'parallel', 'premium', 'parallelCard');
  addAssignment('paraProduct', 'para', 'premium', 'paraCard');
  addAssignment('basicProduct', 'basicuser', 'business', 'basicCard');
  addAssignment('hybridParallelProduct', 'hybridparallel', 'premium', 'hybridParallelCard');
  addAssignment('catProduct', 'inactivecat', 'premium', 'catCard');
  addAssignment('langProduct', 'oldlang', 'premium', 'langCard');
  addAssignment('standeeProduct', 'standeeuser', 'standee');
  addAssignment('crossProduct', 'cross', 'premium', 'crossCard');
  addAssignment('mislabeledProduct', 'cross', 'business', 'mislabeledCard');
  addAssignment('publicSlugProduct', 'cross', 'publicslug', 'publicSlugCard');
  addAssignment('legacySlugProduct', 'cross', 'legacyslug', 'legacySlugCard');
  addAssignment('unknownProduct', 'cross', 'unknown', 'unknownCard');
  addAssignment('inactiveProductOnly', 'cross', 'inactiveproduct');
  addAssignment('missingCardProduct', 'apiuser', 'premium', undefined, 'active', { cardId: oid() });

  await db.collection('users').insertMany(Object.values(users));
  await db.collection('catalogproducts').insertMany(Object.values(products));
  await db.collection('cards').insertMany(Object.values(cards));
  await db.collection('userproducts').insertMany(Object.values(assignments));

  await db.collection('reviewcategories').insertMany([
    {
      _id: oid(),
      key: 'cafe',
      name: 'Cafe',
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
      key: 'hybrid-cat',
      name: 'Hybrid Category',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      key: 'varied-cat',
      name: 'Varied Category',
      active: true,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      key: 'old-cat',
      name: 'Old Inactive Category',
      active: false,
      languages: ['English'],
      scenarios: [{ key: 'service', name: 'Service' }],
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const template = (
    key: string,
    categoryKey: string,
    scenario: string,
    language: string,
    text: string,
    length: string,
    style: string,
    keywords: string[] = []
  ) => ({
    _id: oid(),
    key,
    categoryKey,
    scenario,
    language,
    text,
    length,
    style,
    variables: [],
    compatibleKeywords: keywords,
    active: true,
    usageCount: 0,
    lastShownAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('reviewtemplates').insertMany([
    template('cafe-en-short', 'cafe', 'service', 'English', 'Cafe short {businessName}.', 'short', 'friendly', ['cosy']),
    template('cafe-en-medium', 'cafe', 'quality', 'English', 'Cafe medium {businessName}.', 'medium', 'professional', ['fast']),
    template('cafe-en-detailed', 'cafe', 'service', 'English', 'Cafe detailed {businessName}.', 'detailed', 'casual'),
    template('cafe-es-short', 'cafe', 'service', 'Spanish', 'Cafe corto {businessName}.', 'short', 'friendly'),
    template('hybrid-en-short', 'hybrid-cat', 'service', 'English', 'Hybrid short {businessName}.', 'short', 'friendly'),
    template('varied-short', 'varied-cat', 'service', 'English', 'Varied short {businessName}.', 'short', 'friendly'),
    template('varied-medium', 'varied-cat', 'service', 'English', 'Varied medium {businessName}.', 'medium', 'friendly'),
    template('varied-detailed', 'varied-cat', 'service', 'English', 'Varied detailed {businessName}.', 'detailed', 'friendly'),
  ]);

  await db.collection('reviewsettings').insertMany([
    centralSettings(users.apiuser._id, {
      general: {
        enabled: true,
        googleReviewUrl: 'https://example.test/api-central',
        welcomeMessage: 'API central welcome',
      },
    }),
    centralSettings(users.central._id, {
      general: {
        enabled: true,
        googleReviewUrl: 'https://example.test/central-central',
        welcomeMessage: 'Central welcome',
      },
    }),
    centralSettings(users.hybrid._id, {
      general: {
        enabled: true,
        googleReviewUrl: 'https://example.test/central-hybrid',
        welcomeMessage: 'Hybrid central welcome',
      },
    }),
    centralSettings(users.connector._id),
    centralSettings(users.parallel._id),
    centralSettings(users.hybridparallel._id),
    centralSettings(users.inactivecat._id, {
      content: {
        category: 'old-cat',
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
    }),
    centralSettings(users.oldlang._id, {
      content: {
        category: 'cafe',
        languages: ['Klingon'],
        writingStyle: 'friendly',
        preferredLength: 'medium',
        styleMode: 'fixed',
        lengthMode: 'fixed',
        feedbackTopics: [],
        services: [],
        employees: [],
        keywords: [],
      },
    }),
    {
      ...centralSettings(users.invalidcentral._id),
      schemaVersion: 999,
    },
  ]);

  const shortTemplate = (await db.collection('reviewtemplates').findOne({
    key: 'cafe-en-short',
  })) as { _id: mongoose.Types.ObjectId };
  await db.collection('reviewrotationevents').insertMany([
    {
      _id: oid(),
      businessId: users.apiuser._id,
      categoryKey: 'cafe',
      templateId: shortTemplate._id,
      cycle: 0,
      copyId: 'seed-copy-events-1',
      cardId: cards.apiCard._id,
      copiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      _id: oid(),
      businessId: users.connector._id,
      categoryKey: 'cafe',
      templateId: shortTemplate._id,
      cycle: 0,
      copyId: 'seed-copy-events-connector',
      cardId: cards.connectorCard._id,
      copiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}

function tokenFor(user: SeedUser, expiresIn = '1h') {
  return jwt.sign({ userId: String(user._id), role: user.role }, secret, { expiresIn });
}

async function api(
  method: string,
  path: string,
  options: {
    user?: SeedUser;
    token?: string;
    body?: unknown;
    raw?: string;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {}
) {
  const headers: Record<string, string> = {
    'x-real-ip': `10.45.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`,
    ...(options.headers ?? {}),
  };
  const token = options.token ?? (options.user ? tokenFor(options.user) : undefined);
  if (token) headers.cookie = `token=${token}`;
  if (options.body !== undefined || options.raw !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (method !== 'GET' && options.origin !== null) {
    headers.origin = options.origin ?? BASE;
  }
  const response = await fetch(BASE + path, {
    method,
    headers,
    redirect: 'manual',
    ...(options.raw !== undefined
      ? { body: options.raw }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // HTML pages are expected for some checks.
  }
  return { status: response.status, text, json, headers: response.headers };
}

async function getCard(id: unknown) {
  return (await Card.findById(id).lean()) as Record<string, unknown>;
}
async function rawCard(id: unknown) {
  const db = database();
  return db.collection('cards').findOne({ _id: new mongoose.Types.ObjectId(String(id)) });
}

const UNAVAILABLE = 'Reviews aren’t available right now';
function unavailablePage(text: string) {
  return text.includes(UNAVAILABLE);
}

async function summary() {
  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} checks passed (gate ${EXPECT_GATE ? 'ON' : 'OFF'})`);
  if (passed !== results.length) {
    console.log('Failures:');
    for (const result of results.filter((item) => !item.ok)) {
      console.log(`- ${result.name}: ${result.detail}`);
    }
  }
  await mongoose.disconnect();
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

async function main() {
  await seed();

  // ── 1. Index definitions ────────────────────────────────────────────────
  await check('index: ReviewSettings businessId is unique', async () => {
    const businessId = oid();
    await ReviewSettings.create(centralSettings(businessId));
    await assert.rejects(
      ReviewSettings.create(centralSettings(businessId)),
      (error: { code?: number }) => error.code === 11000
    );
  });
  await check('index: rotation event uniqueness and state unique key', async () => {
    const businessId = oid();
    const templateId = oid();
    const event = {
      businessId,
      categoryKey: 'cafe',
      templateId,
      cycle: 0,
      copyId: `index-copy-${Date.now()}`,
    };
    await ReviewRotationEvent.create(event);
    await assert.rejects(
      ReviewRotationEvent.create({ ...event, copyId: `index-copy-${Date.now()}-b` }),
      (error: { code?: number }) => error.code === 11000
    );
    await ReviewRotationState.create({ businessId, categoryKey: 'cafe' });
    await assert.rejects(
      ReviewRotationState.create({ businessId, categoryKey: 'cafe' }),
      (error: { code?: number }) => error.code === 11000
    );
  });
  await check('index: expected index keys/names exist', async () => {
    const settingsIndexes = await database().collection('reviewsettings').indexes();
    ok(settingsIndexes.some((index) => index.name === 'businessId_1' && index.unique === true), 'businessId_1 missing');
    const eventIndexes = await database().collection('reviewrotationevents').indexes();
    ok(eventIndexes.some((index) => index.name === 'copyId_1' && index.unique === true), 'copyId_1 missing');
    ok(
      eventIndexes.some(
        (index) => index.name === 'businessId_1_categoryKey_1_templateId_1_cycle_1' && index.unique === true
      ),
      'rotation event compound unique missing'
    );
    const stateIndexes = await database().collection('reviewrotationstates').indexes();
    ok(
      stateIndexes.some(
        (index) => index.name === 'businessId_1_categoryKey_1' && index.unique === true
      ),
      'rotation state unique missing'
    );
  });

  // ── 2. Resolver unit tests ───────────────────────────────────────────────
  const legacyConfig = {
    enabled: true,
    googleReviewUrl: 'https://example.test/legacy',
    welcomeMessage: 'Legacy',
    category: 'cafe',
    languages: ['English'],
    writingStyle: 'casual' as const,
    preferredLength: 'short' as const,
    feedbackTopics: ['Service'],
    services: ['Espresso'],
    employees: ['Asha'],
    keywords: ['cosy'],
  };
  await check('resolver: legacy is unchanged and fixed-mode', () => {
    const resolved = resolveReviewSettings({ card: { reviewAssistant: legacyConfig } });
    ok(resolved.source === 'legacy', resolved.source);
    ok(resolved.writingStyle === 'casual' && resolved.preferredLength === 'short', 'legacy values changed');
    ok(resolved.styleMode === 'fixed' && resolved.lengthMode === 'fixed', 'legacy modes changed');
  });
  await check('resolver: central applies defaults + central values', () => {
    const resolved = resolveReviewSettings({
      card: { reviewAssistant: { enabled: false } },
      source: 'central',
      centralSettings: centralSettings(oid()),
    });
    ok(resolved.source === 'central', resolved.source);
    ok(resolved.enabled === true && resolved.googleReviewUrl === 'https://example.test/central', 'central values missing');
    ok(resolved.languages.join(',') === 'English,Spanish', 'central languages missing');
  });
  await check('resolver: hybrid overrides win, including modes', () => {
    const resolved = resolveReviewSettings({
      card: { reviewAssistant: legacyConfig },
      source: 'hybrid',
      centralSettings: centralSettings(oid()),
      overrides: {
        enabled: false,
        writingStyle: 'simple',
        styleMode: 'varied',
        preferredLength: 'detailed',
        lengthMode: 'varied',
        keywords: [],
      },
    });
    ok(resolved.source === 'hybrid', resolved.source);
    ok(resolved.enabled === false, 'enabled override lost');
    ok(resolved.writingStyle === 'simple' && resolved.styleMode === 'varied', 'style override lost');
    ok(resolved.preferredLength === 'detailed' && resolved.lengthMode === 'varied', 'length override lost');
    ok((resolved.keywords ?? []).length === 0, 'empty override did not clear keywords');
  });
  await check('resolver: invalid central/override falls back to complete legacy', () => {
    const invalidCentral = resolveReviewSettings({
      card: { reviewAssistant: legacyConfig },
      source: 'central',
      centralSettings: { schemaVersion: 999 },
    });
    ok(invalidCentral.source === 'legacy-fallback', invalidCentral.source);
    ok(invalidCentral.welcomeMessage === 'Legacy', 'legacy fallback changed');
    const invalidOverride = resolveReviewSettings({
      card: { reviewAssistant: legacyConfig },
      source: 'hybrid',
      centralSettings: centralSettings(oid()),
      overrides: { writingStyle: 'not-a-style' },
    });
    ok(invalidOverride.source === 'legacy-fallback', invalidOverride.source);
  });
  await check('resolver: override projection keeps known fields only', () => {
    const normalized = normalizeReviewOverrides({
      enabled: false,
      googleReviewUrl: 'https://example.test/x',
      styleMode: 'varied',
      unknownLegacyField: 'keep-me-out-of-the-ui',
    });
    ok(normalized.enabled === false, 'enabled missing');
    ok(normalized.styleMode === 'varied', 'mode missing');
    ok(!('unknownLegacyField' in normalized), 'unknown key leaked to UI');
  });

  // ── 3. Entitlement decision table ───────────────────────────────────────
  await check('entitlement: Premium + lower-tier mixed account is isolated', async () => {
    const premium = await getCardReviewEntitlement(cards.mixedPremium as never);
    const lower = await getCardReviewEntitlement(cards.mixedLower as never);
    ok(premium.entitled && premium.source === 'product', 'premium card denied');
    ok(lower.entitled === false && lower.source === 'none', 'lower-tier card inherited review access');
  });
  await check('entitlement: Premium + unassigned lower-tier profile is denied', async () => {
    const result = await getCardReviewEntitlement(cards.zeroDisabled as never);
    ok(result.entitled === false && result.source === 'none', `unexpected ${result.source}`);
  });
  await check('entitlement: unassigned review-kind legacy host is preserved', async () => {
    const result = await getCardReviewEntitlement(cards.zeroReview as never);
    ok(result.entitled && result.source === 'legacy-review-host', `unexpected ${result.source}`);
  });
  await check('entitlement: already-enabled zero-assignment profile is preserved', async () => {
    const result = await getCardReviewEntitlement(cards.zeroEnabled as never);
    ok(result.entitled && result.source === 'legacy-preserved', `unexpected ${result.source}`);
  });
  await check('entitlement: removed assignment does not grant access', async () => {
    const result = await getCardReviewEntitlement(cards.removedCard as never);
    ok(result.entitled === false, 'removed assignment granted access');
  });
  await check('entitlement: inactive/deleted assignment states are safe', async () => {
    const inactive = await getCardReviewEntitlement(cards.inactiveCard as never);
    ok(inactive.entitled, 'inactive CARD should still be product-entitled (publishing is separate)');
    const missingBase = {
      _id: oid(),
      userId: users.apiuser._id,
      assignedUserId: users.apiuser._id,
      kind: 'profile',
    };
    const missingDisabled = await getCardReviewEntitlement({
      ...missingBase,
      reviewAssistant: { enabled: false },
    } as never);
    ok(missingDisabled.entitled === false, 'missing metadata + disabled granted new access');
    const missingEnabled = await getCardReviewEntitlement({
      ...missingBase,
      reviewAssistant: { enabled: true },
    } as never);
    ok(
      missingEnabled.entitled && missingEnabled.source === 'legacy-preserved',
      'already-enabled missing metadata was not preserved'
    );
  });
  await check('entitlement: display name and unknown public slug do not grant capability', async () => {
    const mislabeled = await getCardReviewEntitlement(cards.mislabeledCard as never);
    const publicSlug = await getCardReviewEntitlement(cards.publicSlugCard as never);
    const unknown = await getCardReviewEntitlement(cards.unknownCard as never);
    ok(!mislabeled.entitled && !publicSlug.entitled && !unknown.entitled, 'an unsupported identifier granted access');
  });
  await check('entitlement: canonical Premium slug grants for existing and new assignments', async () => {
    const existing = await getCardReviewEntitlement(cards.premiumCard as never);
    const created = await getCardReviewEntitlement(cards.premiumNew as never);
    ok(existing.entitled && created.entitled, 'canonical Premium assignment not recognized');
    ok(existing.productId === 'PREMIUM_NFC_CARD', String(existing.productId));
  });
  await check('entitlement: legacy premium-card catalog slug grants for historical assignments', async () => {
    const legacy = await getCardReviewEntitlement(cards.legacySlugCard as never);
    ok(legacy.entitled && legacy.productId === 'PREMIUM_NFC_CARD', `legacy slug not recognized (${legacy.productId ?? 'none'})`);
  });
  await check('entitlement: manually granted review account keeps legitimate access', async () => {
    const entitlement = await resolveEntitlement(users.legacyreview._id);
    ok(entitlement.capabilities.has('review_ai_suggestions'), 'Google Review capability missing');
    ok(entitlement.productIds.includes('GOOGLE_REVIEW_CARD'), 'Google Review product missing');
  });
  await check('catalog: Premium capability and Standee behavior are preserved', async () => {
    ok(getProductCapabilities('PREMIUM_NFC_CARD').includes('review_ai_suggestions'), 'Premium capability missing');
    const entitlement = await resolveEntitlement(users.premium._id);
    ok(entitlement.capabilities.has('review_ai_suggestions'), 'Premium account capability missing');
    // Existing Standee behavior includes review_ai_suggestions; 4D.5 preserves
    // it while refusing to invent a Card-backed review host.
    ok(
      getProductCapabilities('GOOGLE_REVIEW_STANDEE').includes('review_ai_suggestions'),
      'Standee review capability unexpectedly removed'
    );
    const standee = await resolveEntitlement(users.standeeuser._id);
    ok(standee.productIds.includes('GOOGLE_REVIEW_STANDEE'), 'Standee product lost');
    ok(standee.capabilities.has('standee'), 'Standee capability lost');
  });

  // ── 4. Settings API ──────────────────────────────────────────────────────
  let apiRevision = '0';
  await check('settings API: authenticated read returns saved central settings', async () => {
    const response = await api('GET', '/api/review-management', { user: users.apiuser });
    ok(response.status === 200, `status ${response.status}`);
    const body = response.json as { saved?: boolean; revision?: string; settings?: { general?: { welcomeMessage?: string } } };
    ok(body.saved === true && body.revision === '0', 'saved/revision shape changed');
    ok(body.settings?.general?.welcomeMessage === 'API central welcome', 'saved central settings missing');
    apiRevision = body.revision ?? '0';
  });
  await check('settings API: partial patch increments revision and preserves other fields', async () => {
    const response = await api('PATCH', '/api/review-management', {
      user: users.apiuser,
      body: { general: { welcomeMessage: 'Updated welcome' }, revision: apiRevision },
    });
    ok(response.status === 200, `status ${response.status}: ${response.text}`);
    const body = response.json as { revision?: string; settings?: { general?: { welcomeMessage?: string; googleReviewUrl?: string } } };
    ok(body.revision === '1', `revision ${body.revision}`);
    ok(body.settings?.general?.welcomeMessage === 'Updated welcome', 'patch not applied');
    ok(body.settings?.general?.googleReviewUrl === 'https://example.test/api-central', 'unrelated field lost');
    apiRevision = body.revision ?? '1';
  });
  await check('settings API: stale revision returns 409 and no write', async () => {
    const response = await api('PATCH', '/api/review-management', {
      user: users.apiuser,
      body: { general: { welcomeMessage: 'Stale write' }, revision: '0' },
    });
    ok(response.status === 409, `status ${response.status}`);
    const read = await api('GET', '/api/review-management', { user: users.apiuser });
    const body = read.json as { settings?: { general?: { welcomeMessage?: string } } };
    ok(body.settings?.general?.welcomeMessage === 'Updated welcome', 'stale write was applied');
  });
  await check('settings API: older client without revision remains compatible', async () => {
    const response = await api('PATCH', '/api/review-management', {
      user: users.apiuser,
      body: { general: { welcomeMessage: 'No revision client' } },
    });
    ok(response.status === 200, `status ${response.status}`);
    const read = await api('GET', '/api/review-management', { user: users.apiuser });
    const body = read.json as { revision?: string; settings?: { general?: { welcomeMessage?: string } } };
    ok(body.settings?.general?.welcomeMessage === 'No revision client', 'legacy client write failed');
    apiRevision = body.revision ?? '2';
  });
  await check('settings API: validation rejects unsafe/unknown payloads', async () => {
    const cases: Array<[string, unknown, number]> = [
      ['unknown field', { general: { welcomeMessage: 'x' }, extra: true }, 400],
      ['invalid JSON', '{', 400],
      ['prototype pollution', '{"general":{"__proto__":{"polluted":true}}}', 400],
      ['invalid URL', { general: { googleReviewUrl: 'javascript:alert(1)' } }, 400],
      ['invalid language type', { content: { languages: 'English' } }, 400],
      ['invalid topic type', { content: { feedbackTopics: [{}] } }, 400],
      ['invalid revision type', { general: { welcomeMessage: 'x' }, revision: -1 }, 400],
      ['oversized body', { general: { welcomeMessage: 'x'.repeat(70_000) } }, 413],
    ];
    for (const [name, payload, expected] of cases) {
      const response = await api('PATCH', '/api/review-management', {
        user: users.apiuser,
        ...(typeof payload === 'string' ? { raw: payload } : { body: payload }),
      });
      ok(response.status === expected, `${name}: expected ${expected}, got ${response.status}`);
    }
  });
  await check('settings API: auth, entitlement, CSRF and expiry', async () => {
    const unauth = await api('PATCH', '/api/review-management', {
      body: { general: { welcomeMessage: 'x' } },
    });
    ok(unauth.status === 401, `unauth ${unauth.status}`);
    const expired = await api('PATCH', '/api/review-management', {
      token: tokenFor(users.apiuser, '-1s'),
      body: { general: { welcomeMessage: 'x' } },
    });
    ok([307, 401, 403].includes(expired.status), `expired ${expired.status}`);
    const missing = await api('GET', '/api/review-management', { user: users.basicuser });
    ok(missing.status === 403, `missing entitlement ${missing.status}`);
    const noOrigin = await api('PATCH', '/api/review-management', {
      user: users.apiuser,
      origin: null,
      body: { general: { welcomeMessage: 'x' } },
    });
    ok(noOrigin.status === 403, `missing origin ${noOrigin.status}`);
    const evil = await api('PATCH', '/api/review-management', {
      user: users.apiuser,
      origin: 'http://evil.test',
      body: { general: { welcomeMessage: 'x' } },
    });
    ok(evil.status === 403, `invalid origin ${evil.status}`);
  });
  await check('model: enabled settings require a language and a safe destination URL', async () => {
    const noLanguage = centralSettings(oid(), {
      general: { enabled: true, googleReviewUrl: '', welcomeMessage: '' },
      content: {
        category: 'cafe',
        languages: [],
        writingStyle: 'friendly',
        preferredLength: 'medium',
        styleMode: 'fixed',
        lengthMode: 'fixed',
        feedbackTopics: [],
        services: [],
        employees: [],
        keywords: [],
      },
    });
    await assert.rejects(
      ReviewSettings.create(noLanguage),
      /At least one language is required when Review Assistant is enabled/
    );
    await assert.rejects(
      ReviewSettings.create(
        centralSettings(oid(), {
          general: { enabled: true, googleReviewUrl: 'javascript:alert(1)', welcomeMessage: '' },
        })
      ),
      /Google Review URL/
    );
  });
  await check('options API: category-scoped options, invalid category and entitlement', async () => {
    const options = await api('GET', '/api/review-management/options?category=cafe', {
      user: users.apiuser,
    });
    ok(options.status === 200, `options ${options.status}`);
    const body = options.json as {
      categories?: Array<{ key?: string; languages?: string[] }>;
      languages?: string[];
      scenarios?: unknown[];
      suggestedFeedbackTopics?: unknown[];
    };
    ok((body.categories ?? []).some((category) => category.key === 'cafe'), 'cafe category missing');
    ok((body.languages ?? []).includes('English'), 'English option missing');
    ok((body.languages ?? []).includes('Spanish'), 'Spanish option missing');
    ok((body.scenarios ?? []).length > 0, 'scenario options missing');
    ok((body.suggestedFeedbackTopics ?? []).length > 0, 'topic suggestions missing');
    const invalid = await api('GET', '/api/review-management/options?category=missing-category', {
      user: users.apiuser,
    });
    ok(invalid.status === 400, `invalid category ${invalid.status}`);
    const forbidden = await api('GET', '/api/review-management/options?category=cafe', {
      user: users.basicuser,
    });
    ok(forbidden.status === 403, `missing entitlement ${forbidden.status}`);
  });

  await check('settings API: saved inactive category and unsupported language are preserved', async () => {
    const inactive = await api('PATCH', '/api/review-management', {
      user: users.inactivecat,
      body: { general: { welcomeMessage: 'Keep inactive category' } },
    });
    ok(inactive.status === 200, `inactive category preserved: ${inactive.status}`);
    const inactiveChange = await api('PATCH', '/api/review-management', {
      user: users.inactivecat,
      body: { content: { category: 'missing-category' } },
    });
    ok(inactiveChange.status === 400, `new inactive category: ${inactiveChange.status}`);
    const language = await api('PATCH', '/api/review-management', {
      user: users.oldlang,
      body: { content: { languages: ['Klingon'] } },
    });
    ok(language.status === 200, `legacy language preserved: ${language.status}`);
    const languageAdd = await api('PATCH', '/api/review-management', {
      user: users.oldlang,
      body: { content: { languages: ['Klingon', 'Elvish'] } },
    });
    ok(languageAdd.status === 400, `new unsupported language: ${languageAdd.status}`);
  });

  // ── 5. Concurrency ───────────────────────────────────────────────────────
  await check('concurrency: two simultaneous settings writes + stale revision', async () => {
    const first = api('PATCH', '/api/review-management', {
      user: users.para,
      body: { general: { welcomeMessage: 'Parallel A' }, revision: '0' },
    });
    const second = api('PATCH', '/api/review-management', {
      user: users.para,
      body: { general: { googleReviewUrl: 'https://example.test/parallel-b' }, revision: '0' },
    });
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    ok(statuses[0] === 200 && statuses[1] === 409, `statuses ${statuses.join(',')}`);
    const read = await api('GET', '/api/review-management', { user: users.para });
    const body = read.json as { revision?: string; settings?: { general?: { welcomeMessage?: string; googleReviewUrl?: string } } };
    ok(body.revision === '1', `revision ${body.revision}`);
    const applied = body.settings?.general?.welcomeMessage === 'Parallel A' ||
      body.settings?.general?.googleReviewUrl === 'https://example.test/parallel-b';
    ok(applied, 'winner was not persisted');
  });
  await check('concurrency: two simultaneous revision-less partial writes keep both fields', async () => {
    const read = await api('GET', '/api/review-management', { user: users.para });
    const revision = (read.json as { revision?: string }).revision ?? '1';
    const first = api('PATCH', '/api/review-management', {
      user: users.para,
      body: { general: { welcomeMessage: 'Both A' } },
    });
    const second = api('PATCH', '/api/review-management', {
      user: users.para,
      body: { general: { googleReviewUrl: 'https://example.test/both-b' } },
    });
    const [a, b] = await Promise.all([first, second]);
    ok(a.status === 200 && b.status === 200, `statuses ${a.status},${b.status}`);
    const after = await api('GET', '/api/review-management', { user: users.para });
    const body = after.json as { revision?: string; settings?: { general?: { welcomeMessage?: string; googleReviewUrl?: string } } };
    ok(body.settings?.general?.welcomeMessage === 'Both A', 'welcome lost');
    ok(body.settings?.general?.googleReviewUrl === 'https://example.test/both-b', 'URL lost');
    ok(Number(body.revision) > Number(revision), 'revision did not advance');
  });
  await check('concurrency: retry after conflict succeeds', async () => {
    const read = await api('GET', '/api/review-management', { user: users.para });
    const revision = (read.json as { revision?: string }).revision ?? '0';
    const retry = await api('PATCH', '/api/review-management', {
      user: users.para,
      body: { general: { welcomeMessage: 'Retry after conflict' }, revision },
    });
    ok(retry.status === 200, `retry ${retry.status}`);
  });

  // ── 6. Product list + preview ────────────────────────────────────────────
  await check('products API: lists eligible Premium only; lower-tier excluded', async () => {
    const response = await api('GET', '/api/review-management/products', { user: users.mixed });
    ok(response.status === 200, `status ${response.status}`);
    const rows = (response.json as { products?: Array<{ cardId: string; reviewOverrides?: unknown }> }).products ?? [];
    const ids = rows.map((row) => row.cardId);
    ok(ids.includes(String(cards.mixedPremium._id)), 'Premium card missing');
    ok(!ids.includes(String(cards.mixedLower._id)), 'lower-tier card listed');
    ok(rows.every((row) => typeof row.reviewOverrides === 'object'), 'reviewOverrides missing from product rows');
    const premium = rows.find((row) => row.cardId === String(cards.mixedPremium._id)) as
      | { legacySettings?: { googleReviewUrl?: string; enabled?: boolean } }
      | undefined;
    ok(premium?.legacySettings && typeof premium.legacySettings.googleReviewUrl === 'string', 'legacySettings missing from product row');
  });
  await check('preview API: legacy/central/hybrid/fallback are read-only and correct', async () => {
    const legacy = await api('GET', `/api/review-management/preview?assignmentId=${assignments.apiProduct._id}`, {
      user: users.apiuser,
    });
    ok(legacy.status === 200, `legacy ${legacy.status}`);
    const legacyBody = legacy.json as { source?: string; settings?: { googleReviewUrl?: string } };
    // Central-only: a saved central document is authoritative even for a card
    // whose stored source is legacy.
    ok(legacyBody.source === 'central', `legacy source ${legacyBody.source}`);
    ok(legacyBody.settings?.googleReviewUrl?.includes('legacy-api-review'), 'product destination missing');

    const central = await api('GET', `/api/review-management/preview?assignmentId=${assignments.centralProduct._id}`, {
      user: users.central,
    });
    const centralBody = central.json as { source?: string; settings?: { googleReviewUrl?: string; styleMode?: string } };
    ok(centralBody.source === 'central', `central source ${centralBody.source}`);
    ok(centralBody.settings?.googleReviewUrl === 'https://example.test/legacy-central-review', 'product destination missing');

    const hybrid = await api('GET', `/api/review-management/preview?assignmentId=${assignments.hybridProduct._id}`, {
      user: users.hybrid,
    });
    const hybridBody = hybrid.json as { source?: string; settings?: { writingStyle?: string; styleMode?: string } };
    ok(hybridBody.source === 'central', `hybrid source ${hybridBody.source}`);
    ok(hybridBody.settings?.writingStyle === 'friendly' && hybridBody.settings?.styleMode === 'fixed', 'hybrid content leaked');

    const fallback = await api('GET', `/api/review-management/preview?assignmentId=${assignments.fallbackProduct._id}`, {
      user: users.fallback,
    });
    const fallbackBody = fallback.json as { source?: string; published?: boolean; settings?: { googleReviewUrl?: string } };
    ok(fallbackBody.source === 'legacy', `fallback source ${fallbackBody.source}`);
    ok(fallbackBody.published === false, 'fallback unexpectedly published');
    ok(fallbackBody.settings?.googleReviewUrl?.includes('legacy-fallback-review'), 'fallback did not preserve legacy destination');

    const invalid = await api('GET', `/api/review-management/preview?assignmentId=${assignments.invalidCentralProduct._id}`, {
      user: users.invalidcentral,
    });
    const invalidBody = invalid.json as { source?: string; published?: boolean };
    ok(invalidBody.source === 'legacy', `invalid central source ${invalidBody.source}`);
    ok(invalidBody.published === false, 'invalid central unexpectedly published');
  });
  await check('preview API: cross-tenant and lower-tier are rejected', async () => {
    const cross = await api('GET', `/api/review-management/preview?assignmentId=${assignments.apiProduct._id}`, {
      user: users.cross,
    });
    ok([403, 404].includes(cross.status), `cross ${cross.status}`);
    const lower = await api('GET', `/api/review-management/preview?assignmentId=${assignments.mixedLowerProduct._id}`, {
      user: users.mixed,
    });
    ok([403, 404].includes(lower.status), `lower ${lower.status}`);
  });

  // ── 7. Connection API ────────────────────────────────────────────────────
  const connector = users.connector;
  let connectorRevision = 0;
  async function connectorPatch(body: unknown, options: { origin?: string | null; user?: SeedUser; token?: string; raw?: string } = {}) {
    return api('PATCH', `/api/review-management/products/${assignments.connectorProduct._id}`, {
      user: options.user ?? connector,
      token: options.token,
      origin: options.origin,
      body,
      raw: options.raw,
    });
  }

  await check('connection: central is explicit, additive and reversible', async () => {
    const before = await rawCard(cards.connectorCard._id);
    const response = await connectorPatch({ source: 'central', revision: connectorRevision });
    ok(response.status === 200, `status ${response.status}: ${response.text}`);
    const after = await rawCard(cards.connectorCard._id);
    ok(after?.reviewSettingsSource === 'central', 'source not central');
    ok(after?.reviewSettingsVersion === 1, `version ${after?.reviewSettingsVersion}`);
    ok(after?.urlAlias === before?.urlAlias && after?.slug === before?.slug, 'alias changed');
    assert.deepEqual(after?.reviewAssistant, before?.reviewAssistant);
    connectorRevision = 1;
  });
  await check('connection: hybrid content writes are rejected without mutation', async () => {
    const before = await rawCard(cards.connectorCard._id);
    const response = await connectorPatch({
      source: 'hybrid',
      revision: connectorRevision,
      overrides: {
        enabled: true,
        googleReviewUrl: 'https://example.test/connector-hybrid',
        welcomeMessage: 'Connector welcome',
        category: 'hybrid-cat',
        languages: ['English'],
        writingStyle: 'casual',
        styleMode: 'varied',
      },
    });
    ok(response.status === 400, `status ${response.status}: ${response.text}`);
    const after = await rawCard(cards.connectorCard._id);
    ok(after?.reviewSettingsSource === before?.reviewSettingsSource, 'source changed on rejected write');
    ok(after?.reviewSettingsVersion === before?.reviewSettingsVersion, 'revision changed on rejected write');
    assert.deepEqual(after?.reviewOverrides, before?.reviewOverrides);
    assert.deepEqual(after?.reviewAssistant, before?.reviewAssistant);
  });
  await check('connection: destination-only update preserves central source/content', async () => {
    const db = database();
    await db.collection('cards').updateOne(
      { _id: new mongoose.Types.ObjectId(String(cards.connectorCard._id)) },
      { $set: { 'reviewOverrides.legacyCustomField': 'keep-me' } }
    );
    const before = await rawCard(cards.connectorCard._id);
    const response = await connectorPatch({
      source: 'destination',
      revision: connectorRevision,
      destination: { googleReviewUrl: 'https://example.test/connector-destination' },
    });
    ok(response.status === 200, `status ${response.status}: ${response.text}`);
    const after = await rawCard(cards.connectorCard._id);
    ok(after?.reviewSettingsSource === 'central', 'central source lost');
    ok(after?.reviewSettingsVersion === (before?.reviewSettingsVersion ?? 0) + 1, 'revision not advanced');
    ok(after?.reviewOverrides?.googleReviewUrl === 'https://example.test/connector-destination', 'destination missing');
    ok(after?.reviewOverrides?.legacyCustomField === 'keep-me', 'unknown override key deleted');
    assert.deepEqual(after?.reviewAssistant, before?.reviewAssistant);
    connectorRevision += 1;
  });
  await check('connection: legacy content writes are rejected without mutation', async () => {
    const before = await rawCard(cards.connectorCard._id);
    const response = await connectorPatch({ source: 'legacy', revision: connectorRevision });
    ok(response.status === 400, `status ${response.status}`);
    const after = await rawCard(cards.connectorCard._id);
    ok(after?.reviewSettingsSource === before?.reviewSettingsSource, 'source changed on rejected legacy write');
    ok(after?.reviewSettingsVersion === before?.reviewSettingsVersion, 'revision changed on rejected legacy write');
    assert.deepEqual(after?.reviewOverrides, before?.reviewOverrides);
    assert.deepEqual(after?.reviewAssistant, before?.reviewAssistant);
  });
  await check('connection: repeated central connections remain stable', async () => {
    const first = await connectorPatch({ source: 'central', revision: connectorRevision });
    ok(first.status === 200, `central ${first.status}`);
    const second = await connectorPatch({ source: 'central', revision: connectorRevision + 1 });
    ok(second.status === 200, `central retry ${second.status}`);
    const card = await rawCard(cards.connectorCard._id);
    ok(
      card?.reviewSettingsSource === 'central' &&
        card?.reviewSettingsVersion === connectorRevision + 2,
      'central cycle state inconsistent'
    );
    connectorRevision += 2;
  });
  await check('connection: central connection preserves stored legacy overrides', async () => {
    const db = database();
    await db.collection('cards').updateOne(
      { _id: new mongoose.Types.ObjectId(String(cards.catCard._id)) },
      { $set: { 'reviewOverrides.category': 'old-cat', 'reviewOverrides.keywords': ['keep'] } }
    );
    const cat = await api('PATCH', `/api/review-management/products/${assignments.catProduct._id}`, {
      user: users.inactivecat,
      body: { source: 'central', revision: 0 },
    });
    ok(cat.status === 200, `central cat ${cat.status}: ${cat.text}`);
    const catAfter = await rawCard(cards.catCard._id);
    ok(catAfter?.reviewOverrides?.category === 'old-cat', 'inactive category lost');

    await db.collection('cards').updateOne(
      { _id: new mongoose.Types.ObjectId(String(cards.langCard._id)) },
      { $set: { 'reviewOverrides.languages': ['Klingon'], 'reviewOverrides.keywords': ['keep'] } }
    );
    const lang = await api('PATCH', `/api/review-management/products/${assignments.langProduct._id}`, {
      user: users.oldlang,
      body: { source: 'central', revision: 0 },
    });
    ok(lang.status === 200, `central lang ${lang.status}: ${lang.text}`);
    const langAfter = await rawCard(cards.langCard._id);
    ok(langAfter?.reviewOverrides?.languages?.[0] === 'Klingon', 'legacy language lost');
  });
  await check('connection: missing central settings and invalid hosts are rejected', async () => {
    const missing = await api('PATCH', `/api/review-management/products/${assignments.fallbackProduct._id}`, {
      user: users.fallback,
      body: { source: 'central' },
    });
    ok(missing.status === 400, `missing central ${missing.status}`);
    const inactive = await api('PATCH', `/api/review-management/products/${assignments.inactiveProduct._id}`, {
      user: users.inactive,
      body: { source: 'central' },
    });
    ok(inactive.status === 400, `inactive card ${inactive.status}`);
    const noIdentifier = await api('PATCH', `/api/review-management/products/${assignments.apiNoIdentifier._id}`, {
      user: users.apiuser,
      body: { source: 'central' },
    });
    ok(noIdentifier.status === 400, `no-identifier card ${noIdentifier.status}`);

    const missingCard = await api('PATCH', `/api/review-management/products/${assignments.missingCardProduct._id}`, {
      user: users.apiuser,
      body: { source: 'central' },
    });
    ok(missingCard.status === 404, `missing card ${missingCard.status}`);
  });
  await check('connection: auth, tenant, entitlement, CSRF and validation', async () => {
    const cases: Array<[string, { status: number }, () => ReturnType<typeof connectorPatch>]> = [
      ['unauthenticated', { status: 401 }, () =>
        api('PATCH', `/api/review-management/products/${assignments.connectorProduct._id}`, {
          body: { source: 'central' },
        })],
      ['expired token', { status: 401 }, () => connectorPatch({ source: 'central' }, { token: tokenFor(connector, '-1s') })],
      ['cross-tenant', { status: 404 }, () => connectorPatch({ source: 'central' }, { user: users.cross })],
      ['lower-tier card', { status: 403 }, () =>
        api('PATCH', `/api/review-management/products/${assignments.mixedLowerProduct._id}`, {
          user: users.mixed,
          body: { source: 'central' },
        })],
      ['removed assignment', { status: 404 }, () =>
        api('PATCH', `/api/review-management/products/${assignments.removedProduct._id}`, {
          user: users.removed,
          body: { source: 'central' },
        })],
      ['missing origin', { status: 403 }, () => connectorPatch({ source: 'central' }, { origin: null })],
      ['invalid origin', { status: 403 }, () => connectorPatch({ source: 'central' }, { origin: 'http://evil.test' })],
      ['invalid source', { status: 400 }, () => connectorPatch({ source: 'mystery' })],
      ['unknown field', { status: 400 }, () => connectorPatch({ source: 'central', extra: true })],
      ['prototype pollution', { status: 400 }, () => connectorPatch({}, { raw: '{"source":"central","__proto__":{"polluted":true}}' })],
      ['invalid override type', { status: 400 }, () => connectorPatch({ source: 'hybrid', overrides: { enabled: 'yes' } })],
      ['invalid override URL', { status: 400 }, () => connectorPatch({ source: 'hybrid', overrides: { googleReviewUrl: 'javascript:alert(1)' } })],
      ['invalid language array', { status: 400 }, () => connectorPatch({ source: 'hybrid', overrides: { languages: 'English' } })],
      ['invalid topic array', { status: 400 }, () => connectorPatch({ source: 'hybrid', overrides: { feedbackTopics: [{}] } })],
      ['invalid revision', { status: 400 }, () => connectorPatch({ source: 'central', revision: -1 })],
      ['oversized body', { status: 413 }, () =>
        connectorPatch({ source: 'central', padding: 'x'.repeat(70_000) })],
      ['missing central settings', { status: 400 }, () =>
        api('PATCH', `/api/review-management/products/${assignments.fallbackProduct._id}`, {
          user: users.fallback,
          body: { source: 'central' },
        })],
      ['deleted card', { status: 404 }, () =>
        api('PATCH', `/api/review-management/products/${assignments.missingCardProduct._id}`, {
          user: users.apiuser,
          body: { source: 'central' },
        })],
    ];
    for (const [name, expected, run] of cases) {
      const response = await run();
      ok(response.status === expected.status, `${name}: expected ${expected.status}, got ${response.status}`);
    }
  });
  await check('connection: stale revision returns 409 and retry succeeds', async () => {
    const stale = await connectorPatch({ source: 'central', revision: 0 });
    ok(stale.status === 409, `stale ${stale.status}`);
    const fresh = await connectorPatch({ source: 'central', revision: connectorRevision });
    ok(fresh.status === 200, `retry ${fresh.status}`);
    connectorRevision += 1;
  });
  await check('concurrency: simultaneous product connections have one winner', async () => {
    const first = api('PATCH', `/api/review-management/products/${assignments.parallelProduct._id}`, {
      user: users.parallel,
      body: { source: 'central', revision: 0 },
    });
    const second = api('PATCH', `/api/review-management/products/${assignments.parallelProduct._id}`, {
      user: users.parallel,
      body: {
        source: 'destination',
        revision: 0,
        destination: { googleReviewUrl: 'https://example.test/parallel-destination' },
      },
    });
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    ok(statuses[0] === 200 && statuses[1] === 409, `statuses ${statuses.join(',')}`);
    const card = await rawCard(cards.parallelCard._id);
    ok(card?.reviewSettingsVersion === 1, `version ${card?.reviewSettingsVersion}`);
    ok(
      card?.reviewSettingsSource === 'central' || card?.reviewSettingsSource === 'legacy',
      `parallel winner source inconsistent: ${card?.reviewSettingsSource}`
    );
  });
  await check('concurrency: simultaneous destination updates do not merge', async () => {
    const first = api('PATCH', `/api/review-management/products/${assignments.hybridParallelProduct._id}`, {
      user: users.hybridparallel,
      body: {
        source: 'destination',
        revision: 0,
        destination: { googleReviewUrl: 'https://example.test/concurrent-first' },
      },
    });
    const second = api('PATCH', `/api/review-management/products/${assignments.hybridParallelProduct._id}`, {
      user: users.hybridparallel,
      body: {
        source: 'destination',
        revision: 0,
        destination: { googleReviewUrl: 'https://example.test/concurrent-second' },
      },
    });
    const [a, b] = await Promise.all([first, second]);
    const statuses = [a.status, b.status].sort();
    ok(statuses[0] === 200 && statuses[1] === 409, `statuses ${statuses.join(',')}`);
    const card = await rawCard(cards.hybridParallelCard._id);
    const url = card?.reviewOverrides?.googleReviewUrl;
    ok(
      url === 'https://example.test/concurrent-first' ||
        url === 'https://example.test/concurrent-second',
      `winner unclear ${url}`
    );
  });
  await check('concurrency: settings update + product connection remain consistent', async () => {
    const read = await api('GET', '/api/review-management', { user: users.connector });
    const revision = (read.json as { revision?: string }).revision ?? '0';
    const settings = api('PATCH', '/api/review-management', {
      user: users.connector,
      body: { general: { welcomeMessage: 'Concurrent settings' }, revision },
    });
    const connection = connectorPatch({ source: 'central', revision: connectorRevision });
    const [a, b] = await Promise.all([settings, connection]);
    ok(a.status === 200, `settings ${a.status}`);
    ok(b.status === 200, `connection ${b.status}`);
    const card = await rawCard(cards.connectorCard._id);
    ok(card?.reviewSettingsSource === 'central', 'source inconsistent');
    connectorRevision += 1;
  });

  // ── 8. Card editor authorization ─────────────────────────────────────────
  await check('card editor: legacy content writes rejected, lower-tier cannot enable', async () => {
    const premium = await api('PATCH', `/api/cards/${cards.premiumCard._id}`, {
      user: users.premium,
      body: { reviewAssistant: { enabled: true } },
    });
    ok(premium.status === 400, `premium content ${premium.status}: ${premium.text}`);
    const premiumDestination = await api('PATCH', `/api/cards/${cards.premiumCard._id}`, {
      user: users.premium,
      body: { reviewAssistant: { googleReviewUrl: 'https://example.test/premium-destination' } },
    });
    ok(premiumDestination.status === 200, `premium destination ${premiumDestination.status}: ${premiumDestination.text}`);
    const lower = await api('PATCH', `/api/cards/${cards.mixedLower._id}`, {
      user: users.mixed,
      body: { reviewAssistant: { enabled: true } },
    });
    ok(lower.status === 403, `lower ${lower.status}`);
    const ambiguous = await api('PATCH', `/api/cards/${cards.zeroDisabled._id}`, {
      user: users.zerodisabled,
      body: { reviewAssistant: { enabled: true } },
    });
    ok(ambiguous.status === 403, `zero-assignment disabled ${ambiguous.status}`);
    const preserved = await api('PATCH', `/api/cards/${cards.zeroEnabled._id}`, {
      user: users.zeroenabled,
      body: { reviewAssistant: { enabled: true } },
    });
    ok(preserved.status === 400, `zero-assignment content ${preserved.status}`);
  });
  await check('card settings editor: destination save changes only the target Card', async () => {
    const before = await rawCard(cards.premiumNew._id);
    const patched = await api('PATCH', `/api/cards/${cards.premiumCard._id}`, {
      user: users.premium,
      body: { reviewAssistant: { googleReviewUrl: 'https://example.test/only-this-card' } },
    });
    ok(patched.status === 200, `patch ${patched.status}: ${patched.text}`);
    const changed = await rawCard(cards.premiumCard._id);
    const untouched = await rawCard(cards.premiumNew._id);
    ok(
      (changed?.reviewAssistant as { googleReviewUrl?: string } | undefined)?.googleReviewUrl ===
        'https://example.test/only-this-card',
      'target Card destination was not updated'
    );
    ok(
      JSON.stringify((untouched?.reviewAssistant as unknown) ?? null) ===
        JSON.stringify((before?.reviewAssistant as unknown) ?? null),
      'another Card was modified'
    );
  });
  await check('card editor: unauthorized and cross-tenant requests are denied', async () => {
    const cross = await api('PATCH', `/api/cards/${cards.apiCard._id}`, {
      user: users.cross,
      body: { name: 'Hijack' },
    });
    ok([403, 404].includes(cross.status), `cross ${cross.status}`);
    const unauth = await api('PATCH', `/api/cards/${cards.apiCard._id}`, {
      body: { name: 'Hijack' },
    });
    ok(unauth.status === 401, `unauth ${unauth.status}`);
  });
  await check('entitlement API: owner sees product-aware decision', async () => {
    const premium = await api('GET', `/api/cards/${cards.premiumCard._id}/review-entitlement`, {
      user: users.premium,
    });
    ok(premium.status === 200, `premium ${premium.status}`);
    ok((premium.json as { entitled?: boolean }).entitled === true, 'premium not entitled');
    const lower = await api('GET', `/api/cards/${cards.mixedLower._id}/review-entitlement`, {
      user: users.mixed,
    });
    ok((lower.json as { entitled?: boolean }).entitled === false, 'lower-tier entitled');
    const preserved = await api('GET', `/api/cards/${cards.zeroEnabled._id}/review-entitlement`, {
      user: users.zeroenabled,
    });
    ok((preserved.json as { source?: string }).source === 'legacy-preserved', 'preserved source missing');
    const cross = await api('GET', `/api/cards/${cards.premiumCard._id}/review-entitlement`, {
      user: users.cross,
    });
    ok([403, 404].includes(cross.status), `cross ${cross.status}`);
  });

  // ── 9. Public review + backward compatibility ────────────────────────────
  await check('public: legacy review routes remain reachable but fail closed', async () => {
    for (const alias of ['premium-review', 'grc-review', 'plate-review']) {
      const page = await api('GET', `/review/${alias}`);
      ok(page.status === 200, `${alias} page ${page.status}`);
      ok(unavailablePage(page.text), `${alias} unexpectedly published`);
    }
    const suggestions = await api('POST', '/api/public/reviews/premium-review/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(suggestions.status === 404, `legacy suggestions ${suggestions.status}`);
  });
  await check('public: lower-tier, removed and inactive hosts are denied', async () => {
    for (const alias of ['lower-review', 'mixed-lower-review', 'removed-review', 'inactive-review']) {
      const page = await api('GET', `/review/${alias}`);
      ok(page.status === 200 || page.status === 404, `${alias} status ${page.status}`);
      if (page.status === 200) ok(unavailablePage(page.text), `${alias} rendered without entitlement`);
    }
    const suggestions = await api('POST', '/api/public/reviews/mixed-lower-review/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok([404, 403].includes(suggestions.status), `lower suggestions ${suggestions.status}`);
  });
  await check('public: central/hybrid gate behavior', async () => {
    const central = await api('GET', '/review/central-review');
    const hybrid = await api('GET', '/review/hybrid-review');
    if (EXPECT_GATE) {
      ok(!unavailablePage(central.text), 'gate ON central unavailable');
      ok(central.text.includes('Central welcome'), 'gate ON central welcome missing');
      ok(!unavailablePage(hybrid.text), 'gate ON hybrid unavailable');
      ok(hybrid.text.includes('Hybrid central welcome'), 'gate ON hybrid central base missing');
      const suggestions = await api('POST', '/api/public/reviews/central-review/suggestions', {
        body: { language: 'English', length: 'medium' },
      });
      ok(suggestions.status === 200, `gate ON central suggestions ${suggestions.status}`);
      const hybridSuggestions = await api('POST', '/api/public/reviews/hybrid-review/suggestions', {
        body: { language: 'English', length: 'short' },
      });
      ok(hybridSuggestions.status === 200, `gate ON hybrid suggestions ${hybridSuggestions.status}`);
    } else {
      ok(unavailablePage(central.text), 'gate OFF central did not stay legacy');
      ok(unavailablePage(hybrid.text), 'gate OFF hybrid did not stay legacy');
      const suggestions = await api('POST', '/api/public/reviews/central-review/suggestions', {
        body: { language: 'English', length: 'medium' },
      });
      ok(suggestions.status === 404, `gate OFF central suggestions ${suggestions.status}`);
    }
  });
  await check('public: missing/invalid central settings fail closed', async () => {
    const fallback = await api('GET', '/review/fallback-review');
    const invalid = await api('GET', '/review/invalid-central-review');
    ok(fallback.status === 200 && unavailablePage(fallback.text), 'fallback page published');
    ok(invalid.status === 200 && unavailablePage(invalid.text), 'invalid central page published');
    const fallbackSuggestions = await api('POST', '/api/public/reviews/fallback-review/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(fallbackSuggestions.status === 404, `fallback suggestions ${fallbackSuggestions.status}`);
  });
  await check('public: copy event records and is idempotent when central is published', async () => {
    if (!EXPECT_GATE) {
      const closed = await api('POST', '/api/public/reviews/central-review/copied', {
        body: { templateId: '000000000000000000000000', copyId: `suite-copy-closed-${Date.now()}` },
      });
      ok(closed.status === 404, `gate OFF copy ${closed.status}`);
      return;
    }
    const suggestions = await api('POST', '/api/public/reviews/central-review/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    const templateId = (suggestions.json as { suggestions?: Array<{ templateId?: string }> }).suggestions?.[0]?.templateId;
    ok(templateId, 'no template id');
    const db = database();
    const before = await db.collection('reviewrotationevents').countDocuments({ copyId: /^suite-copy-/ });
    const copyId = `suite-copy-${Date.now()}`;
    const first = await api('POST', '/api/public/reviews/central-review/copied', {
      body: { templateId, copyId },
    });
    ok([200, 201].includes(first.status), `first copy ${first.status}`);
    const second = await api('POST', '/api/public/reviews/central-review/copied', {
      body: { templateId, copyId },
    });
    ok(second.status === 200, `duplicate copy ${second.status}`);
    const after = await db.collection('reviewrotationevents').countDocuments({ copyId: /^suite-copy-/ });
    ok(after === before + 1, `copy event count ${before} -> ${after}`);
  });
  await check('compatibility: aliases, templates, rotation history and reviewAssistant survive', async () => {
    const before = await rawCard(cards.connectorCard._id);
    const templatesBefore = await ReviewTemplate.countDocuments({});
    const eventsBefore = await ReviewRotationEvent.countDocuments({ businessId: users.connector._id });
    const response = await connectorPatch({ source: 'central', revision: connectorRevision });
    ok(response.status === 200, `connection ${response.status}`);
    const after = await rawCard(cards.connectorCard._id);
    ok(after?.urlAlias === before?.urlAlias && after?.slug === before?.slug, 'alias changed');
    assert.deepEqual(after?.reviewAssistant, before?.reviewAssistant);
    ok((await ReviewTemplate.countDocuments({})) === templatesBefore, 'templates changed');
    ok((await ReviewRotationEvent.countDocuments({ businessId: users.connector._id })) === eventsBefore, 'rotation history changed');
    connectorRevision += 1;
    const page = await api('GET', '/review/api-review');
    ok(page.status === 200, 'existing public review route broke');
    const profile = await api('GET', '/profile/api-review');
    ok(profile.status === 200, 'existing public profile route broke');
  });
  await check('compatibility: dashboard and standee isolation', async () => {
    const dashboard = await api('GET', '/dashboard/review-management', { user: users.apiuser });
    ok(dashboard.status === 200, `dashboard ${dashboard.status}`);
    const lowerDashboard = await api('GET', '/dashboard/review-management', { user: users.basicuser });
    ok(lowerDashboard.status !== 200, 'lower-tier account reached Review Management');
    const standeeProducts = await api('GET', '/api/review-management/products', { user: users.standeeuser });
    ok(standeeProducts.status === 200, `standee products ${standeeProducts.status}`);
    ok(
      ((standeeProducts.json as { products?: unknown[] }).products ?? []).length === 0,
      'a fake Card-backed Standee review host was created'
    );
    const standeeEntitlement = await resolveEntitlement(users.standeeuser._id);
    ok(standeeEntitlement.productIds.includes('GOOGLE_REVIEW_STANDEE'), 'standee product lost');
  });

  await summary();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
