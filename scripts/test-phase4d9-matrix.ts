/**
 * Phase 4D.9 — 16-combination feature-flag matrix.
 *
 * Runs the same 12 release-critical checks against the current code for one
 * explicit flag combination. The shell driver starts a fresh server and a fresh
 * disposable database for each of the 16 combinations and sets:
 *
 *   NEW_REVIEW_COPY_FLOW_ENABLED
 *   SMART_REVIEW_ROTATION_ENABLED
 *   CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED
 *   STANDEE_REVIEW_ASSISTANT_ENABLED
 *
 * Usage (example):
 *   MONGODB_URI=mongodb://localhost:27017 \
 *   MONGODB_DB=taprevia_4d9_matrix \
 *   TEST_BASE=http://localhost:3501 \
 *   NEW_REVIEW_COPY_FLOW_ENABLED=true SMART_REVIEW_ROTATION_ENABLED=false \
 *   CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=true STANDEE_REVIEW_ASSISTANT_ENABLED=true \
 *   npx tsx scripts/test-phase4d9-matrix.ts
 *
 * This script never touches production, never rewrites fixtures after seeding
 * and refuses any database outside `taprevia_4d9_` or any non-local base URL.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import TenantSettings from '@/models/TenantSettings';
import { connectDB } from '@/lib/db';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { resolveStandeeReviewHost, resolveStandeeReviewProduct } from '@/lib/services/review-standee-settings';
import { REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import { encryptSecret } from '@/lib/crypto';

const require = createRequire('/Users/prince/Documents/CRM/package.json');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE ?? 'http://localhost:3501';
const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('taprevia_4d9_')) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_4d9_ (got "${DB_NAME}")`);
  process.exit(2);
}
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing non-local TEST_BASE: ${BASE}`);
  process.exit(2);
}

const FLAG = (name: string) => process.env[name] === 'true';
const COPY = FLAG('NEW_REVIEW_COPY_FLOW_ENABLED');
const ROTATION = FLAG('SMART_REVIEW_ROTATION_ENABLED');
const CENTRAL = FLAG('CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED');
const STANDEE = FLAG('STANDEE_REVIEW_ASSISTANT_ENABLED');
const COMBO = `copy=${COPY} rotation=${ROTATION} central=${CENTRAL} standee=${STANDEE}`;

const envFile = fs.readFileSync('/Users/prince/Documents/CRM/.env.local', 'utf8');
const envValue = (key: string) => {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(envFile);
  return match ? match[1].trim().replace(/^"|"$/g, '') : undefined;
};
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = envValue('JWT_SECRET');
const configuredAppKey = process.env.APP_KEY ?? envValue('APP_KEY');
if (configuredAppKey && Buffer.from(configuredAppKey, 'base64').length === 32) {
  process.env.APP_KEY = configuredAppKey;
} else {
  delete process.env.APP_KEY;
}
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET missing');

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
const ok: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new Error(message);
};
const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

function database(): NonNullable<typeof mongoose.connection.db> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection not ready');
  return db;
}

interface FixtureUser { _id: mongoose.Types.ObjectId; email: string; role: string; status: string }
function userDoc(name: string, email: string, status = 'active'): FixtureUser & Record<string, unknown> {
  return {
    _id: oid(), name, email, role: 'customer', status,
    passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now,
  };
}

const users: Record<string, FixtureUser> = {};
for (const key of ['owner', 'other', 'lower', 'suspended'] as const) {
  users[key] = userDoc(key, `${key}@matrix49.test`, key === 'suspended' ? 'suspended' : 'active');
}

const products: Record<string, Record<string, unknown>> = {};
function product(key: string, slug: string, name: string, kind: string, category: string) {
  products[key] = { _id: oid(), slug, name, kind, category, active: true, createdAt: now, updatedAt: now };
}
product('grc', 'google-review-card', 'Google Review Card', 'review', 'card');
product('plate', 'google-review-nfc-plate', 'Google Review NFC Plate', 'review', 'card');
product('premium', 'premium-nfc-card', 'Premium NFC Card', 'profile', 'card');
product('business', 'business-nfc-card', 'Business NFC Card', 'profile', 'card');
product('standee', 'google-review-standee', 'Google Review Standee', 'standee', 'standee');

const GRC_URL = 'https://example.test/grc-legacy-4d9';
const PLATE_URL = 'https://example.test/plate-legacy-4d9';
const PREMIUM_URL = 'https://example.test/premium-legacy-4d9';
const CENTRAL_URL = 'https://example.test/central-4d9';
const HYBRID_URL = 'https://example.test/hybrid-override-4d9';
const STANDEE_URL = 'https://example.test/standee-google-4d9';

const cards: Record<string, Record<string, unknown>> = {};
function cardDoc(
  userId: mongoose.Types.ObjectId,
  alias: string,
  routeSlug: string,
  kind: 'review' | 'profile',
  enabled: boolean,
  googleReviewUrl: string,
  source: 'legacy' | 'central' | 'hybrid' = 'legacy',
  overrides?: Record<string, unknown>,
) {
  return {
    _id: oid(), cardUid: `A49-${alias.toUpperCase()}`, slug: alias, urlAlias: alias,
    publicSlug: alias, routeSlug, uid: routeSlug, name: alias, kind,
    userId, assignedUserId: userId, status: 'active', isActive: true, setupComplete: true,
    reviewSettingsSource: source, reviewSettingsVersion: 0,
    ...(overrides ? { reviewOverrides: overrides } : {}),
    reviewAssistant: {
      enabled, googleReviewUrl, writingStyle: 'friendly', preferredLength: 'short',
      languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome',
      category: 'cafe', employees: [], services: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  };
}
cards.grc = cardDoc(users.owner._id, 'grc-4d9', 'routegrc49', 'review', true, GRC_URL);
cards.plate = cardDoc(users.owner._id, 'plate-4d9', 'routeplate49', 'review', true, PLATE_URL);
cards.premium = cardDoc(users.owner._id, 'premium-4d9', 'routepremium49', 'profile', true, PREMIUM_URL);
cards.lower = cardDoc(users.owner._id, 'lower-4d9', 'routelower49', 'profile', false, '');
cards.central = cardDoc(users.owner._id, 'central-4d9', 'routecentral49', 'review', true, GRC_URL, 'central');
cards.hybrid = cardDoc(users.owner._id, 'hybrid-4d9', 'routehybrid49', 'review', true, GRC_URL, 'hybrid', { googleReviewUrl: HYBRID_URL });
cards.other = cardDoc(users.other._id, 'other-4d9', 'routeother49', 'review', true, 'https://example.test/other-4d9');
cards.suspended = cardDoc(users.suspended._id, 'suspended-4d9', 'routesuspended49', 'review', true, 'https://example.test/suspended-4d9');

const standees: Record<string, Record<string, unknown>> = {};
function standeeDoc(userId: mongoose.Types.ObjectId, routeSlug: string, googleUrl: string) {
  return {
    _id: oid(), userId, name: routeSlug, displayName: routeSlug, routeSlug, uid: routeSlug,
    productKey: 'GOOGLE_REVIEW_STANDEE', maxProfiles: 1, fixedProfiles: ['google_review'],
    reviewSettingsSource: 'central',
    panelQr: { qrId: `panel-${routeSlug}`, qrColor: '#000000' },
    socialQrs: [{
      qrId: `qr-google-${routeSlug}`, platform: 'google_review', label: 'Google Review',
      qrColor: '#000000', destinationUrl: googleUrl,
    }],
    createdAt: now, updatedAt: now,
  };
}
standees.owner = standeeDoc(users.owner._id, 'standee-4d9', STANDEE_URL);
standees.unassigned = standeeDoc(users.owner._id, 'standee-unassigned-4d9', 'https://example.test/standee-unassigned-4d9');
standees.other = standeeDoc(users.other._id, 'standee-other-4d9', 'https://example.test/standee-other-4d9');

const assignments: Record<string, Record<string, unknown>> = {};
function assign(key: string, userKey: string, productKey: string, instance: { cardKey?: string; standeeKey?: string }, status: 'active' | 'removed' = 'active') {
  assignments[key] = {
    _id: oid(), userId: users[userKey]._id, catalogProductId: products[productKey]._id,
    cardId: instance.cardKey ? cards[instance.cardKey]._id : null,
    standeeId: instance.standeeKey ? standees[instance.standeeKey]._id : null,
    quantity: 1, status, createdAt: now, updatedAt: now,
  };
}
assign('grc', 'owner', 'grc', { cardKey: 'grc' });
assign('plate', 'owner', 'plate', { cardKey: 'plate' });
assign('premium', 'owner', 'premium', { cardKey: 'premium' });
assign('lower', 'owner', 'business', { cardKey: 'lower' });
assign('central', 'owner', 'grc', { cardKey: 'central' });
assign('hybrid', 'owner', 'grc', { cardKey: 'hybrid' });
assign('ownerStandee', 'owner', 'standee', { standeeKey: 'owner' });
assign('other', 'other', 'grc', { cardKey: 'other' });
assign('otherStandee', 'other', 'standee', { standeeKey: 'other' });
assign('suspended', 'suspended', 'grc', { cardKey: 'suspended' });

function settingsDoc(businessId: mongoose.Types.ObjectId) {
  return {
    businessId, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: CENTRAL_URL, welcomeMessage: 'Central welcome 4D.9' },
    content: {
      category: 'cafe', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    updatedBy: businessId, createdAt: now, updatedAt: now, __v: 0,
  };
}

async function seed() {
  await connectDB();
  const db = database();
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }

  await db.collection('users').insertMany(Object.values(users));
  await db.collection('profiles').insertMany([
    { _id: oid(), userId: users.owner._id, companyInfo: { companyName: 'Owner Matrix Co' }, socialLinks: [], createdAt: now, updatedAt: now },
    { _id: oid(), userId: users.other._id, companyInfo: { companyName: 'Other Matrix Co' }, socialLinks: [], createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertMany(Object.values(products));
  await db.collection('cards').insertMany(Object.values(cards));
  await db.collection('standees').insertMany(Object.values(standees));
  await db.collection('userproducts').insertMany(Object.values(assignments));
  await db.collection('reviewcategories').insertOne({
    _id: oid(), key: 'cafe', name: 'Cafe', active: true, languages: ['English'],
    scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now,
  });
  const templates = [
    ['t1', 'Short {businessName}.', 'short'],
    ['t2', 'Medium {businessName}.', 'medium'],
    ['t3', 'Detailed {businessName}.', 'detailed'],
  ] as const;
  await db.collection('reviewtemplates').insertMany(templates.map(([key, text, length]) => ({
    _id: oid(), key, categoryKey: 'cafe', scenario: 'service', language: 'English', text, length,
    style: 'friendly', variables: [], compatibleKeywords: [], active: true, usageCount: 0,
    lastShownAt: null, createdAt: now, updatedAt: now,
  })));
  await db.collection('reviewsettings').insertOne(settingsDoc(users.owner._id));

  const log = (host: 'grc' | 'plate' | 'standee' | 'other', action: string, metadata: string, ago: number) => ({
    ...(host === 'standee' ? { standeeId: standees.owner._id } : { cardId: cards[host]._id }),
    action, metadata, createdAt: daysAgo(ago), updatedAt: daysAgo(ago),
  });
  await db.collection('analyticslogs').insertMany([
    log('grc', 'review_page_view', '', 1), log('grc', 'review_page_view', '', 2),
    log('grc', 'review_copied', JSON.stringify({ source: 'ai' }), 1),
    log('grc', 'review_copied', JSON.stringify({ source: 'ai' }), 2),
    log('grc', 'review_copied', JSON.stringify({ source: 'manual' }), 3),
    log('standee', 'review_copied', JSON.stringify({ source: 'ai' }), 1),
    log('other', 'review_page_view', '', 1),
    log('other', 'review_copied', JSON.stringify({ source: 'ai' }), 1),
    log('other', 'review_copied', JSON.stringify({ source: 'manual' }), 2),
  ]);

  await TenantSettings.create({
    userId: users.owner._id,
    openai: { enabled: true, apiKeyEnc: encryptSecret('matrix-test-key'), model: 'gpt-4o-mini', dailyLimit: 0, usage: {} },
  });
}

function tokenFor(user: FixtureUser) {
  return jwt.sign({ userId: String(user._id), role: user.role }, secret, { expiresIn: '1h' });
}
let ip = 1;
async function api(method: string, path: string, options: { user?: FixtureUser; body?: unknown; redirect?: RequestRedirect } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': `10.99.${Math.floor(ip / 250)}.${ip++ % 250}` };
  if (options.user) headers.cookie = `token=${tokenFor(options.user)}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, redirect: options.redirect ?? 'manual',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, location: res.headers.get('location') };
}

function payloadFlag(text: string, key: string): boolean | null {
  const normalized = text.replace(/\\"/g, '"');
  const index = normalized.indexOf(key);
  if (index === -1) return null;
  const window = normalized.slice(index, index + 120);
  const match = /(true|false)/.exec(window);
  return match ? match[1] === 'true' : null;
}

async function main() {
  await seed();
  const analyticsPath = (query: string) => `/api/review-management/analytics?${query}`;

  await check('1. Card public review host and suggestions', async () => {
    const page = await api('GET', '/review/grc-4d9');
    ok(page.status === 200, `page ${page.status}`);
    ok(!page.text.includes('Reviews aren’t available'), 'legacy review page unavailable');
    const suggestions = await api('POST', '/api/public/reviews/grc-4d9/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(suggestions.status === 200, `suggestions ${suggestions.status}`);
    const body = suggestions.json as { mode?: string; suggestions?: unknown[] };
    ok(body.mode === 'template' && (body.suggestions?.length ?? 0) > 0, 'template suggestions missing');
  });

  await check('2. Standee public host follows the Standee gate', async () => {
    const page = await api('GET', '/standee-review/standee-4d9');
    ok(page.status === 200, `host ${page.status}`);
    const available = !page.text.includes('Reviews aren’t available');
    ok(available === STANDEE, `host availability ${available} != gate ${STANDEE}`);
    const suggestions = await api('POST', '/api/public/standee-reviews/standee-4d9/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    if (!STANDEE) {
      ok(suggestions.status === 404, `gate-off suggestions ${suggestions.status}`);
      return;
    }
    ok(suggestions.status === 200, `suggestions ${suggestions.status}`);
    const body = suggestions.json as { mode?: string };
    ok(body.mode === (CENTRAL ? 'template' : 'none'), `suggestions mode ${body.mode}`);
  });

  await check('3. Google destination resolution', async () => {
    const grc = await resolveEffectiveReviewSettings(cards.grc as never);
    ok(grc.googleReviewUrl === GRC_URL, `grc url ${grc.googleReviewUrl}`);
    const central = await resolveEffectiveReviewSettings(cards.central as never);
    const expected = CENTRAL ? CENTRAL_URL : GRC_URL;
    ok(central.googleReviewUrl === expected, `central url ${central.googleReviewUrl} != ${expected}`);
    const page = await api('GET', '/review/central-4d9');
    ok(page.status === 200, `central page ${page.status}`);
    ok(page.text.includes(expected), 'expected Google destination missing from page payload');
    const standeeProduct = await resolveStandeeReviewProduct(standees.owner as never);
    ok(standeeProduct?.googleReviewUrl === STANDEE_URL, 'standee google destination changed');
  });

  await check('4. Product entitlement for all four products', async () => {
    for (const key of ['grc', 'plate', 'premium'] as const) {
      const entitlement = await getCardReviewEntitlement(cards[key] as never);
      ok(entitlement.entitled, `${key} lost entitlement`);
    }
    const standee = await resolveStandeeReviewProduct(standees.owner as never);
    ok(standee && standee.catalogProductSlug === 'google-review-standee', 'standee product entitlement missing');
  });

  await check('5. Lower-tier and ineligible hosts stay restricted', async () => {
    const lower = await getCardReviewEntitlement(cards.lower as never);
    ok(!lower.entitled, 'lower-tier Card gained review entitlement');
    const page = await api('GET', '/review/lower-4d9');
    ok(page.status === 200 && page.text.includes('Reviews aren’t available'), 'lower page exposed');
    const suggestions = await api('POST', '/api/public/reviews/lower-4d9/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    ok(suggestions.status === 404, `lower suggestions ${suggestions.status}`);
    const unassigned = await resolveStandeeReviewHost('standee-unassigned-4d9');
    ok(unassigned === null, 'unassigned Standee host exposed');
    const suspendedPage = await api('GET', '/review/suspended-4d9');
    ok(suspendedPage.status === 404 || suspendedPage.text.includes('Reviews aren’t available'), 'suspended host exposed');
  });

  await check('6. Legacy, central and hybrid settings resolution', async () => {
    const central = await resolveEffectiveReviewSettings(cards.central as never);
    ok(central.source === (CENTRAL ? 'central' : 'legacy'), `central source ${central.source}`);
    const hybrid = await resolveEffectiveReviewSettings(cards.hybrid as never);
    if (CENTRAL) {
      ok(hybrid.source === 'hybrid', `hybrid source ${hybrid.source}`);
      ok(hybrid.googleReviewUrl === HYBRID_URL, `hybrid override ${hybrid.googleReviewUrl}`);
    } else {
      ok(hybrid.source === 'legacy', `hybrid source ${hybrid.source}`);
      ok(hybrid.googleReviewUrl === GRC_URL, `hybrid legacy url ${hybrid.googleReviewUrl}`);
    }
    if (STANDEE) {
      const host = await resolveStandeeReviewHost('standee-4d9');
      ok(host, 'standee host resolution failed');
      const expectedWelcome = CENTRAL ? 'Central welcome 4D.9' : '';
      ok(host!.config.welcomeMessage === expectedWelcome, `standee central content ${host!.config.welcomeMessage}`);
      ok(host!.config.googleReviewUrl === STANDEE_URL, 'standee destination not authoritative');
    }
  });

  await check('7. Copy-flow flag reaches the public UI', async () => {
    for (const alias of ['grc-4d9', 'central-4d9']) {
      const page = await api('GET', `/review/${alias}`);
      ok(page.status === 200, `${alias} page ${page.status}`);
      const value = payloadFlag(page.text, 'copyFlowEnabled');
      ok(value !== null, `${alias} copyFlowEnabled missing from payload`);
      ok(value === COPY, `${alias} copyFlowEnabled ${value} != ${COPY}`);
    }
  });

  await check('8. Smart rotation depends on the copy flow', async () => {
    ok(REVIEW_ROTATION_ACTIVE === (COPY && ROTATION), `rotation active ${REVIEW_ROTATION_ACTIVE}`);
    const suggestions = await api('POST', '/api/public/reviews/grc-4d9/suggestions', {
      body: { language: 'English', length: 'short' },
    });
    const item = (suggestions.json as { suggestions?: Array<{ templateId?: string; rotationToken?: string }> })
      .suggestions?.[0];
    ok(item?.templateId, 'template id missing');
    const copyId = `matrix-rotate-${RANDOM}-1`;
    if (COPY && ROTATION) {
      ok(item?.rotationToken, 'rotation token missing while active');
      const withToken = await api('POST', '/api/public/reviews/grc-4d9/copied', {
        body: { templateId: item!.templateId, copyId, rotationToken: item!.rotationToken },
      });
      ok([200, 201].includes(withToken.status), `token copy ${withToken.status}`);
      const noToken = await api('POST', '/api/public/reviews/grc-4d9/copied', {
        body: { templateId: item!.templateId, copyId: `${copyId}-none` },
      });
      ok(noToken.status === 409, `missing token ${noToken.status}`);
    } else {
      ok(!item?.rotationToken, 'rotation token issued while inactive');
      const legacy = await api('POST', '/api/public/reviews/grc-4d9/copied', {
        body: { templateId: item!.templateId, copyId },
      });
      ok([200, 201].includes(legacy.status), `legacy copy ${legacy.status}`);
    }
  });

  await check('9. Analytics attribution and ranges', async () => {
    const grc = (await api('GET', analyticsPath(`range=30d&host=card:${String(cards.grc._id)}`), { user: users.owner }))
      .json as { totals?: Record<string, number> };
    ok(grc.totals?.visits === 2, `grc visits ${grc.totals?.visits}`);
    ok(grc.totals?.aiCopies === 2, `grc ai ${grc.totals?.aiCopies}`);
    ok(grc.totals?.manualCopies === 1, `grc manual ${grc.totals?.manualCopies}`);
    ok(grc.totals?.totalCopies === 3, `grc copies ${grc.totals?.totalCopies}`);
    ok(grc.totals?.unclassifiedCopies === 0, 'unexpected unclassified copies');
    const standee = (await api('GET', analyticsPath(`range=30d&host=standee:${String(standees.owner._id)}`), { user: users.owner }))
      .json as { totals?: Record<string, number> };
    ok(standee.totals?.aiCopies === 1, `standee ai ${standee.totals?.aiCopies}`);
    const legacy = await api('GET', `/api/analytics?cardId=${String(cards.grc._id)}&from=2026-10-01&to=2026-11-30`, { user: users.owner });
    ok(legacy.status === 200, `legacy analytics ${legacy.status}`);
  });

  await check('10. Cross-tenant isolation', async () => {
    const unauth = await api('GET', analyticsPath('range=30d&host=all'));
    ok(unauth.status === 401, `unauth ${unauth.status}`);
    const lower = await api('GET', analyticsPath('range=30d&host=all'), { user: users.lower });
    ok(lower.status === 403, `lower ${lower.status}`);
    const other = (await api('GET', analyticsPath('range=30d&host=all'), { user: users.other }))
      .json as { totals?: Record<string, number>; products?: Array<Record<string, unknown>> };
    ok(other.totals?.totalCopies === 2, `other copies ${other.totals?.totalCopies}`);
    ok(!(other.products ?? []).some((row) => String(row.title) === 'grc-4d9'), 'cross-tenant card leaked');
    const crossHost = await api('GET', analyticsPath(`range=30d&host=card:${String(cards.other._id)}`), { user: users.owner });
    ok(crossHost.status === 400, `cross host ${crossHost.status}`);
    const badRange = await api('GET', analyticsPath('range=1d'), { user: users.owner });
    ok(badRange.status === 400, `bad range ${badRange.status}`);
  });

  await check('11. NFC/QR routing preserves destinations', async () => {
    const grc = await api('GET', '/r/routegrc49');
    ok(grc.status === 307, `grc route ${grc.status}`);
    ok(new URL(grc.location ?? '').pathname === '/review/grc-4d9', `grc route destination ${grc.location}`);
    const plate = await api('GET', '/r/routeplate49');
    ok(plate.status === 307 && new URL(plate.location ?? '').pathname === '/review/plate-4d9', `plate route ${plate.location}`);
    const standee = await api('GET', '/r/standee-4d9');
    ok(standee.status === 307, `standee route ${standee.status}`);
    const standeeExpected = STANDEE ? '/standee-review/standee-4d9' : STANDEE_URL;
    ok(standeeExpected.startsWith('http') ? standee.location === standeeExpected : new URL(standee.location ?? '').pathname === standeeExpected, `standee destination ${standee.location}`);
    const social = await api('GET', '/qr/qr-google-standee-4d9');
    ok([302, 307].includes(social.status), `social qr ${social.status}`);
    ok(standeeExpected.startsWith('http') ? social.location === standeeExpected : new URL(social.location ?? '').pathname === standeeExpected, `social qr destination ${social.location}`);
    const unassigned = await api('GET', '/r/standee-unassigned-4d9');
    ok(unassigned.status === 307 && unassigned.location === 'https://example.test/standee-unassigned-4d9', `unassigned standee ${unassigned.location}`);
  });

  await check('12. Rollback invariants: flags never rewrite stored data', async () => {
    const db = database();
    const grc = await db.collection('cards').findOne({ urlAlias: 'grc-4d9' });
    ok(grc && grc.routeSlug === 'routegrc49' && grc.urlAlias === 'grc-4d9', 'Card alias/route changed');
    const legacyUrl = (grc.reviewAssistant as { googleReviewUrl?: string } | undefined)?.googleReviewUrl;
    ok(legacyUrl === GRC_URL, 'legacy Google destination changed');
    const standee = await db.collection('standees').findOne({ routeSlug: 'standee-4d9' });
    ok(standee && standee.routeSlug === 'standee-4d9', 'Standee route changed');
    const socialUrl = (standee.socialQrs as Array<{ destinationUrl?: string }> | undefined)?.[0]?.destinationUrl;
    ok(socialUrl === STANDEE_URL, 'Standee destination changed');
    const premium = await getCardReviewEntitlement(cards.premium as never);
    ok(premium.entitled, 'Premium entitlement lost after flag changes');
    const lower = await getCardReviewEntitlement(cards.lower as never);
    ok(!lower.entitled, 'lower-tier entitlement changed after flag changes');
    const copies = await ReviewRotationEvent.countDocuments({ businessId: users.owner._id });
    ok(copies >= 0, 'rotation event query failed');
  });

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} checks passed (${COMBO})`);
  if (passed !== results.length) for (const result of results.filter((item) => !item.ok)) console.log(`- ${result.name}: ${result.detail}`);
  await mongoose.disconnect();
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

const RANDOM = Math.random().toString(36).slice(2, 10);
main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
