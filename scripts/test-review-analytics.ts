/**
 * Phase 4D.7 unified review analytics + four-product suite.
 *
 * Synthetic local fixtures for Google Review Card, NFC Plate, Premium NFC Card
 * and Google Review Standee. Exercises the analytics API, canonical metric
 * definitions, historical rows, tenant isolation, tracking, rotation separation,
 * public hosts, copy endpoints and deterministic AI failure modes.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import ReviewRotationEvent from '@/models/ReviewRotationEvent';
import AnalyticsLog from '@/models/AnalyticsLog';
import TenantSettings from '@/models/TenantSettings';
import { connectDB } from '@/lib/db';
import { resolveEntitlement } from '@/lib/services/capability-access';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolveStandeeReviewProduct } from '@/lib/services/review-standee-settings';
import { generateReviewSuggestion } from '@/lib/services/review-generate';
import { generateReviewForHost } from '@/lib/services/review-generate';
import { encryptSecret } from '@/lib/crypto';

const require = createRequire('/Users/prince/Documents/CRM/package.json');
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE ?? 'http://localhost:3501';
const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('taprevia_4d7_')) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_4d7_ (got "${DB_NAME}")`);
  process.exit(2);
}
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) {
  console.error(`Refusing non-local TEST_BASE: ${BASE}`);
  process.exit(2);
}

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
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) {
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
  return { _id: oid(), name, email, role: 'customer', status, passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now };
}

const users: Record<string, FixtureUser> = {};
const products: Record<string, Record<string, unknown>> = {};
const cards: Record<string, Record<string, unknown>> = {};
const standees: Record<string, Record<string, unknown>> = {};
const assignments: Record<string, Record<string, unknown>> = {};

const USERS = ['owner', 'other', 'lower', 'suspended'] as const;
for (const key of USERS) users[key] = userDoc(key, `${key}@analytics47.test`, key === 'suspended' ? 'suspended' : 'active');

function product(key: string, slug: string, name: string, kind: string, category: string) {
  products[key] = { _id: oid(), slug, name, kind, category, active: true, createdAt: now, updatedAt: now };
}
product('grc', 'google-review-card', 'Google Review Card', 'review', 'card');
product('plate', 'google-review-nfc-plate', 'Google Review NFC Plate', 'review', 'card');
product('premium', 'premium-nfc-card', 'Premium NFC Card', 'profile', 'card');
product('business', 'business-nfc-card', 'Business NFC Card', 'profile', 'card');
product('standee', 'google-review-standee', 'Google Review Standee', 'standee', 'standee');
product('spoof', 'spoof-product', 'Premium NFC Card', 'profile', 'card');

function cardDoc(userId: mongoose.Types.ObjectId, alias: string, kind: 'review' | 'profile', enabled: boolean, isActive = true) {
  return {
    _id: oid(), cardUid: `A47-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
    slug: alias, urlAlias: alias, name: alias, kind, userId, assignedUserId: userId,
    status: 'active', isActive, setupComplete: true, reviewSettingsSource: 'legacy', reviewSettingsVersion: 0,
    reviewAssistant: {
      enabled, googleReviewUrl: `https://example.test/${alias}`, writingStyle: 'friendly',
      preferredLength: 'short', languages: ['English'], feedbackTopics: [], welcomeMessage: 'Welcome',
      category: 'cafe', employees: [], services: [], keywords: [],
    },
    createdAt: now, updatedAt: now,
  };
}
cards.grc = cardDoc(users.owner._id, 'grc-4d7', 'review', true);
cards.plate = cardDoc(users.owner._id, 'plate-4d7', 'review', true);
cards.premium = cardDoc(users.owner._id, 'premium-4d7', 'profile', true);
cards.lower = cardDoc(users.owner._id, 'lower-4d7', 'profile', false);
cards.inactive = cardDoc(users.owner._id, 'inactive-4d7', 'review', true, false);
cards.removed = cardDoc(users.owner._id, 'removed-4d7', 'review', true);
cards.other = cardDoc(users.other._id, 'other-4d7', 'review', true);
cards.suspendedCard = cardDoc(users.suspended._id, 'suspended-4d7', 'review', true);
cards.spoof = cardDoc(users.owner._id, 'spoof-4d7', 'profile', false);

function standeeDoc(userId: mongoose.Types.ObjectId, routeSlug: string, name: string, googleUrl: string) {
  return {
    _id: oid(), userId, name, displayName: name, routeSlug, uid: routeSlug, productKey: 'GOOGLE_REVIEW_STANDEE',
    maxProfiles: 1, fixedProfiles: ['google_review'],
    panelQr: { qrId: `panel-${routeSlug}`, qrColor: '#000000' },
    socialQrs: [{ qrId: `google-${routeSlug}`, platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: googleUrl }],
    createdAt: now, updatedAt: now,
  };
}
standees.owner = standeeDoc(users.owner._id, 'standee-4d7', 'Owner Standee', 'https://example.test/standee-4d7-google');
standees.other = standeeDoc(users.other._id, 'standee-other-4d7', 'Other Standee', 'https://example.test/standee-other-google');
standees.removed = standeeDoc(users.owner._id, 'standee-removed-4d7', 'Removed Standee', 'https://example.test/standee-removed-google');

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
assign('inactive', 'owner', 'grc', { cardKey: 'inactive' });
assign('removed', 'owner', 'grc', { cardKey: 'removed' }, 'removed');
assign('ownerStandee', 'owner', 'standee', { standeeKey: 'owner' });
assign('removedStandee', 'owner', 'standee', { standeeKey: 'removed' }, 'removed');
assign('other', 'other', 'grc', { cardKey: 'other' });
assign('otherStandee', 'other', 'standee', { standeeKey: 'other' });
assign('suspended', 'suspended', 'grc', { cardKey: 'suspendedCard' });
assign('spoof', 'owner', 'spoof', { cardKey: 'spoof' });
assign('lowerBusiness', 'lower', 'business', { cardKey: 'lower' });

function settingsDoc(businessId: mongoose.Types.ObjectId) {
  return {
    businessId, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: 'https://example.test/central-47', welcomeMessage: 'Central welcome' },
    content: { category: 'cafe', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium', styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [] },
    updatedBy: businessId, createdAt: now, updatedAt: now, __v: 0,
  };
}

type HostKey = 'grc' | 'plate' | 'premium' | 'standee' | 'inactive' | 'removed' | 'other' | 'otherStandee';

async function seed() {
  await connectDB();
  const db = database();
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }

  await db.collection('users').insertMany(Object.values(users));
  await db.collection('profiles').insertMany([
    { _id: oid(), userId: users.owner._id, companyInfo: { companyName: 'Owner Analytics Co' }, socialLinks: [], createdAt: now, updatedAt: now },
    { _id: oid(), userId: users.other._id, companyInfo: { companyName: 'Other Analytics Co' }, socialLinks: [], createdAt: now, updatedAt: now },
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
  const templateIds: mongoose.Types.ObjectId[] = [];
  const rows = templates.map(([key, text, length]) => {
    const id = oid(); templateIds.push(id);
    return { _id: id, key, categoryKey: 'cafe', scenario: 'service', language: 'English', text, length, style: 'friendly', variables: [], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now };
  });
  await db.collection('reviewtemplates').insertMany(rows);
  await db.collection('reviewsettings').insertOne(settingsDoc(users.owner._id));

  const hostIds: Record<HostKey, { cardId?: mongoose.Types.ObjectId; standeeId?: mongoose.Types.ObjectId }> = {
    grc: { cardId: cards.grc._id as mongoose.Types.ObjectId },
    plate: { cardId: cards.plate._id as mongoose.Types.ObjectId },
    premium: { cardId: cards.premium._id as mongoose.Types.ObjectId },
    standee: { standeeId: standees.owner._id as mongoose.Types.ObjectId },
    inactive: { cardId: cards.inactive._id as mongoose.Types.ObjectId },
    removed: { cardId: cards.removed._id as mongoose.Types.ObjectId },
    other: { cardId: cards.other._id as mongoose.Types.ObjectId },
    otherStandee: { standeeId: standees.other._id as mongoose.Types.ObjectId },
  };

  const log = (host: HostKey, action: string, metadata: string, ago: number) => ({
    ...(hostIds[host].cardId ? { cardId: hostIds[host].cardId } : { standeeId: hostIds[host].standeeId }),
    action, metadata, createdAt: daysAgo(ago), updatedAt: daysAgo(ago),
  });
  const ai = JSON.stringify({ source: 'ai' });
  const manual = JSON.stringify({ source: 'manual' });
  const events: Array<Record<string, unknown>> = [];

  // Google Review Card: 3 recent visits, 2 AI, 1 manual, one 20d visit, one 60d visit.
  events.push(log('grc', 'review_page_view', '', 0), log('grc', 'review_page_view', '', 1), log('grc', 'review_page_view', '', 2));
  events.push(log('grc', 'review_page_view', '', 20), log('grc', 'review_page_view', '', 60));
  events.push(log('grc', 'review_copied', ai, 0), log('grc', 'review_copied', ai, 1), log('grc', 'review_copied', manual, 2));
  events.push(log('grc', 'review_suggestions_shown', '{"count":1}', 0), log('grc', 'review_generated', '{}', 0), log('grc', 'review_google_clicked', '', 0));

  // Plate: 2 visits, 2 AI (one 20d), 1 manual.
  events.push(log('plate', 'review_page_view', '', 0), log('plate', 'review_page_view', '', 1));
  events.push(log('plate', 'review_copied', ai, 0), log('plate', 'review_copied', ai, 20), log('plate', 'review_copied', manual, 1));

  // Premium: 4 visits, 2 AI, one historical unclassified copy.
  for (const ago of [0, 1, 2, 3]) events.push(log('premium', 'review_page_view', '', ago));
  events.push(log('premium', 'review_copied', ai, 0), log('premium', 'review_copied', ai, 1), log('premium', 'review_copied', '', 2));

  // Standee: 3 visits, 2 AI, 1 manual.
  events.push(log('standee', 'review_page_view', '', 0), log('standee', 'review_page_view', '', 1), log('standee', 'review_page_view', '', 2));
  events.push(log('standee', 'review_copied', ai, 0), log('standee', 'review_copied', ai, 1), log('standee', 'review_copied', manual, 2));

  // Historical inactive and removed hosts.
  events.push(log('inactive', 'review_page_view', '', 1), log('inactive', 'review_copied', ai, 1));
  events.push(log('removed', 'review_page_view', '', 1), log('removed', 'review_copied', manual, 1));

  // Other tenant — must never appear in owner analytics.
  for (const ago of [0, 1, 2, 3, 4]) events.push(log('other', 'review_page_view', '', ago));
  events.push(log('other', 'review_copied', ai, 0), log('other', 'review_copied', ai, 1), log('other', 'review_copied', manual, 2));

  // Existing Standee tap analytics contract.
  events.push({ action: 'tap', metadata: 'route:standee-4d7', createdAt: daysAgo(0), updatedAt: daysAgo(0) });

  await db.collection('analyticslogs').insertMany(events);

  const rotationRows = (['grc', 'plate', 'premium', 'standee', 'inactive', 'removed'] as HostKey[]).map((host, index) => ({
    _id: oid(), businessId: users.owner._id, categoryKey: 'cafe', templateId: templateIds[index % templateIds.length],
    cycle: index, copyId: `rot-owner-${host}-${index}`, ...(hostIds[host].cardId ? { cardId: hostIds[host].cardId } : { standeeId: hostIds[host].standeeId }),
    copiedAt: daysAgo(1), createdAt: daysAgo(1), updatedAt: daysAgo(1),
  }));
  rotationRows.push({
    _id: oid(), businessId: users.other._id, categoryKey: 'cafe', templateId: templateIds[0],
    cycle: 0, copyId: 'rot-other-0', cardId: cards.other._id as mongoose.Types.ObjectId, copiedAt: daysAgo(1), createdAt: daysAgo(1), updatedAt: daysAgo(1),
  });
  await db.collection('reviewrotationevents').insertMany(rotationRows);

  await TenantSettings.create({
    userId: users.owner._id,
    openai: { enabled: true, apiKeyEnc: encryptSecret('analytics-test-key'), model: 'gpt-4o-mini', dailyLimit: 0, usage: {} },
  });
}

function tokenFor(user: FixtureUser, expiresIn = '1h') {
  return jwt.sign({ userId: String(user._id), role: user.role }, secret, { expiresIn });
}
let ip = 1;
async function api(method: string, path: string, options: { user?: FixtureUser; token?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': `10.88.${Math.floor(ip / 250)}.${ip++ % 250}` };
  const token = options.token ?? (options.user ? tokenFor(options.user) : undefined);
  if (token) headers.cookie = `token=${token}`;
  if (options.body !== undefined || options.raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers, redirect: 'manual',
    ...(options.raw !== undefined ? { body: options.raw } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, location: res.headers.get('location') };
}

type AnalyticsBody = {
  totals?: Record<string, number>;
  series?: Array<{ date: string; visits: number; totalCopies: number }>;
  products?: Array<Record<string, unknown>>;
};

async function main() {
  await seed();
  const analyticsPath = (query: string) => `/api/review-management/analytics?${query}`;

  await check('analytics: business 30d totals, series and four-product attribution', async () => {
    const res = await api('GET', analyticsPath('range=30d&host=all'), { user: users.owner });
    ok(res.status === 200, `status ${res.status}: ${res.text}`);
    const body = res.json as AnalyticsBody;
    const totals = body.totals ?? {};
    ok(totals.visits === 15, `visits ${totals.visits}`);
    ok(totals.totalCopies === 14, `copies ${totals.totalCopies}`);
    ok(totals.aiCopies === 9, `ai ${totals.aiCopies}`);
    ok(totals.manualCopies === 4, `manual ${totals.manualCopies}`);
    ok(totals.unclassifiedCopies === 1, `unclassified ${totals.unclassifiedCopies}`);
    ok(totals.rotationCopies === 6, `rotation ${totals.rotationCopies}`);
    ok(totals.suggestionsShown === 1 && totals.generated === 1 && totals.googleClicks === 1, 'secondary metrics wrong');
    ok(body.series?.length === 30, `series length ${body.series?.length}`);
    ok(body.series.reduce((sum, row) => sum + row.visits, 0) === 15, 'series visits mismatch');
    ok(body.series.reduce((sum, row) => sum + row.totalCopies, 0) === 14, 'series copies mismatch');
    const names = (body.products ?? []).map((row) => String(row.productName));
    ok(names.includes('Google Review Card'), 'GRC missing');
    ok(names.includes('Google Review NFC Plate'), 'Plate missing');
    ok(names.includes('Premium NFC Card'), 'Premium missing');
    ok(names.includes('Google Review Standee'), 'Standee missing');
    ok(!(body.products ?? []).some((row) => String(row.title) === 'lower-4d7'), 'lower-tier Card leaked into filter');
    ok(!(body.products ?? []).some((row) => String(row.title) === 'other-4d7'), 'cross-tenant card leaked');
    const grc = (body.products ?? []).find((row) => String(row.title) === 'grc-4d7');
    ok(grc && grc.visits === 4 && grc.aiCopies === 2 && grc.manualCopies === 1 && grc.totalCopies === 3, 'GRC row wrong');
    const premium = (body.products ?? []).find((row) => String(row.title) === 'premium-4d7');
    ok(premium && premium.totalCopies === 3 && premium.unclassifiedCopies === 1, 'Premium unclassified copy missing');
  });
  await check('analytics: 7d/90d ranges and product filters', async () => {
    const week = (await api('GET', analyticsPath('range=7d&host=all'), { user: users.owner })).json as AnalyticsBody;
    ok(week.totals?.visits === 14, `7d visits ${week.totals?.visits}`);
    ok(week.totals?.totalCopies === 13, `7d copies ${week.totals?.totalCopies}`);
    ok(week.totals?.aiCopies === 8, `7d ai ${week.totals?.aiCopies}`);
    const quarter = (await api('GET', analyticsPath('range=90d&host=all'), { user: users.owner })).json as AnalyticsBody;
    ok(quarter.totals?.visits === 16, `90d visits ${quarter.totals?.visits}`);
    ok(quarter.totals?.totalCopies === 14, `90d copies ${quarter.totals?.totalCopies}`);
    ok(quarter.series?.length === 90, `90d series ${quarter.series?.length}`);

    const grcFilter = await api('GET', analyticsPath(`range=30d&host=card:${String(cards.grc._id)}`), { user: users.owner });
    ok(grcFilter.status === 200, `grc filter ${grcFilter.status}`);
    const grc = grcFilter.json as AnalyticsBody;
    ok(grc.totals?.visits === 4 && grc.totals?.totalCopies === 3 && grc.totals?.aiCopies === 2, 'GRC filter wrong');
    ok(grc.products?.length === 6, 'product options should remain stable');

    const standeeFilter = await api('GET', analyticsPath(`range=30d&host=standee:${String(standees.owner._id)}`), { user: users.owner });
    ok(standeeFilter.status === 200, `standee filter ${standeeFilter.status}`);
    const standee = standeeFilter.json as AnalyticsBody;
    ok(standee.totals?.visits === 3 && standee.totals?.totalCopies === 3 && standee.totals?.manualCopies === 1, 'standee filter wrong');
  });
  await check('analytics: historical inactive/removed hosts remain attributable', async () => {
    const body = (await api('GET', analyticsPath('range=30d&host=all'), { user: users.owner })).json as AnalyticsBody;
    const inactive = (body.products ?? []).find((row) => String(row.title) === 'inactive-4d7');
    const removed = (body.products ?? []).find((row) => String(row.title) === 'removed-4d7');
    ok(inactive && inactive.visits === 1 && inactive.totalCopies === 1, 'inactive host missing');
    ok(removed && removed.visits === 1 && removed.manualCopies === 1, 'removed host missing');
    ok(inactive.active === true, 'inactive assignment should remain active in analytics');
    ok(removed.active === false, 'removed host should be historical');
  });
  await check('analytics: tenant isolation, auth and filter validation', async () => {
    const auth = await api('GET', analyticsPath('range=30d&host=all'));
    ok(auth.status === 401, `unauth ${auth.status}`);
    const lower = await api('GET', analyticsPath('range=30d&host=all'), { user: users.lower });
    ok(lower.status === 403, `lower ${lower.status}`);
    const other = await api('GET', analyticsPath('range=30d&host=all'), { user: users.other });
    ok(other.status === 200, `other ${other.status}`);
    const otherBody = other.json as AnalyticsBody;
    ok(otherBody.totals?.visits === 5 && otherBody.totals?.totalCopies === 3, 'other tenant totals wrong');
    ok(!(otherBody.products ?? []).some((row) => String(row.title) === 'grc-4d7'), 'cross-tenant data leaked');
    const crossHost = await api('GET', analyticsPath(`range=30d&host=card:${String(cards.other._id)}`), { user: users.owner });
    ok(crossHost.status === 400, `cross host ${crossHost.status}`);
    const lowerHost = await api('GET', analyticsPath(`range=30d&host=card:${String(cards.lower._id)}`), { user: users.owner });
    ok(lowerHost.status === 400, `lower host ${lowerHost.status}`);
    for (const query of ['range=1d', 'range=30d&host=bad', 'range=30d&from=not-a-date', 'range=30d&from=2026-01-02&to=2026-01-01']) {
      const res = await api('GET', analyticsPath(query), { user: users.owner });
      ok(res.status === 400, `${query} ${res.status}`);
    }
    const expired = await api('GET', analyticsPath('range=30d&host=all'), { token: tokenFor(users.owner, '-1s') });
    ok([307, 401, 403].includes(expired.status), `expired ${expired.status}`);
  });
  await check('analytics: existing /api/analytics Card and Standee contracts still work', async () => {
    const card = await api('GET', `/api/analytics?cardId=${String(cards.grc._id)}&from=2026-10-01&to=2026-11-30`, { user: users.owner });
    ok(card.status === 200, `card analytics ${card.status}`);
    const cardBody = card.json as { totals?: Record<string, number> };
    ok((cardBody.totals?.review_page_view ?? 0) >= 1, 'card review visits missing');
    const standee = await api('GET', `/api/analytics?standeeId=${String(standees.owner._id)}&from=2026-10-01&to=2026-11-30`, { user: users.owner });
    ok(standee.status === 200, `standee analytics ${standee.status}`);
    const standeeBody = standee.json as { totals?: Record<string, number> };
    ok((standeeBody.totals?.tap ?? 0) === 1, 'existing standee tap contract changed');
  });
  await check('tracking: Standee alias resolves for client review analytics', async () => {
    const before = (await api('GET', analyticsPath(`range=30d&host=standee:${String(standees.owner._id)}`), { user: users.owner })).json as AnalyticsBody;
    const manualBefore = before.totals?.manualCopies ?? 0;
    const track = await api('POST', '/api/public/track', {
      body: { alias: 'standee-4d7', action: 'review_copied', metadata: JSON.stringify({ source: 'manual' }) },
    });
    ok(track.status === 202, `standee track ${track.status}`);
    const db = database();
    const row = await db.collection('analyticslogs').findOne({ standeeId: standees.owner._id, action: 'review_copied' });
    ok(row, 'standee copy tracking row missing');
    const after = (await api('GET', analyticsPath(`range=30d&host=standee:${String(standees.owner._id)}`), { user: users.owner })).json as AnalyticsBody;
    ok((after.totals?.manualCopies ?? 0) === manualBefore + 1, 'manual standee copy not counted');
    const invalid = await api('POST', '/api/public/track', { body: { alias: 'not-a-real-standee', action: 'review_copied' } });
    ok(invalid.status === 200, `invalid track ${invalid.status}`);
    const invalidRow = await db.collection('analyticslogs').findOne({ action: 'review_copied', metadata: '' });
    ok(!invalidRow || String(invalidRow.standeeId ?? '') !== 'not-a-real-standee', 'invalid alias persisted');
  });
  await check('four products: entitlements and public review hosts', async () => {
    const grc = await getCardReviewEntitlement(cards.grc as never);
    const plate = await getCardReviewEntitlement(cards.plate as never);
    const premium = await getCardReviewEntitlement(cards.premium as never);
    const lower = await getCardReviewEntitlement(cards.lower as never);
    const removed = await getCardReviewEntitlement(cards.removed as never);
    const spoof = await getCardReviewEntitlement(cards.spoof as never);
    ok(grc.entitled && plate.entitled && premium.entitled, 'a supported Card lost entitlement');
    ok(!lower.entitled, 'lower-tier Card gained review access');
    ok(!removed.entitled, 'removed assignment still entitled');
    ok(!spoof.entitled, 'display-name spoof granted access');
    const standee = await resolveStandeeReviewProduct(standees.owner as never);
    ok(standee, 'Standee host missing');
    const ownerEntitlement = await resolveEntitlement(users.owner._id);
    ok(ownerEntitlement.capabilities.has('review_ai_suggestions'), 'owner review capability missing');

    for (const alias of ['grc-4d7', 'plate-4d7', 'premium-4d7']) {
      const page = await api('GET', `/review/${alias}`);
      ok(page.status === 200, `${alias} page ${page.status}`);
      const suggestions = await api('POST', `/api/public/reviews/${alias}/suggestions`, { body: { language: 'English', length: 'short' } });
      ok(suggestions.status === 200, `${alias} suggestions ${suggestions.status}`);
    }
    const standeePage = await api('GET', '/standee-review/standee-4d7');
    ok(standeePage.status === 200 && !standeePage.text.includes('Reviews aren’t available'), 'Standee host unavailable');
    const standeeSuggestions = await api('POST', '/api/public/standee-reviews/standee-4d7/suggestions', { body: { language: 'English', length: 'short' } });
    ok(standeeSuggestions.status === 200, `standee suggestions ${standeeSuggestions.status}`);

    const lowerPage = await api('GET', '/review/lower-4d7');
    ok(lowerPage.status === 200 && lowerPage.text.includes('Reviews aren’t available'), 'lower Card page exposed');
    const suspendedPage = await api('GET', '/review/suspended-4d7');
    ok(suspendedPage.status === 404 || suspendedPage.text.includes('Reviews aren’t available'), 'suspended Card exposed');
    const removedPage = await api('GET', '/review/removed-4d7');
    ok(removedPage.status === 200 && removedPage.text.includes('Reviews aren’t available'), 'removed Card exposed');
  });
  await check('four products: copy endpoints/idempotency remain compatible', async () => {
    for (const alias of ['grc-4d7', 'plate-4d7', 'premium-4d7']) {
      const suggestions = await api('POST', `/api/public/reviews/${alias}/suggestions`, { body: { language: 'English', length: 'short' } });
      const item = (suggestions.json as { suggestions?: Array<{ templateId?: string }> }).suggestions?.[0];
      ok(item?.templateId, `${alias} template missing`);
      const copyId = `analytics-copy-${alias}-${Date.now()}`;
      const first = await api('POST', `/api/public/reviews/${alias}/copied`, { body: { templateId: item!.templateId, copyId } });
      ok([200, 201].includes(first.status), `${alias} copy ${first.status}`);
      const replay = await api('POST', `/api/public/reviews/${alias}/copied`, { body: { templateId: item!.templateId, copyId } });
      ok(replay.status === 200, `${alias} replay ${replay.status}`);
    }
    const standeeSuggestions = await api('POST', '/api/public/standee-reviews/standee-4d7/suggestions', { body: { language: 'English', length: 'short' } });
    const standeeItem = (standeeSuggestions.json as { suggestions?: Array<{ templateId?: string }> }).suggestions?.[0];
    ok(standeeItem?.templateId, 'Standee template missing');
    const standeeCopyId = `analytics-standee-copy-${Date.now()}`;
    const standeeFirst = await api('POST', '/api/public/standee-reviews/standee-4d7/copied', { body: { templateId: standeeItem!.templateId, copyId: standeeCopyId } });
    ok([200, 201].includes(standeeFirst.status), `Standee copy ${standeeFirst.status}`);
    const standeeReplay = await api('POST', '/api/public/standee-reviews/standee-4d7/copied', { body: { templateId: standeeItem!.templateId, copyId: standeeCopyId } });
    ok(standeeReplay.status === 200, `Standee replay ${standeeReplay.status}`);
  });
  await check('AI: deterministic success, empty and provider-failure behavior', async () => {
    for (const alias of ['grc-4d7', 'plate-4d7', 'premium-4d7']) {
      const success = await generateReviewSuggestion({
        alias, feedback: 'The coffee was good and the staff were very kind.', topics: [], ip: `10.88.1.${alias.length}`, userAgent: 'test',
        complet: async () => ({ text: 'A good cup of coffee with kind staff.', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
      });
      ok(success.ok, `${alias} generation success failed`);
    }
    let shortPrompt = '';
    const shortSuccess = await generateReviewSuggestion({
      alias: 'grc-4d7', feedback: 'good exp', topics: [], language: 'English', length: 'short', ip: '10.88.1.20', userAgent: 'test',
      complet: async (input) => {
        shortPrompt = `${input.system}\n${input.user}`;
        return { text: 'Good experience.', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    });
    ok(shortSuccess.ok, 'short genuine input was rejected by the AI service');
    ok(shortPrompt.includes('good exp'), 'short input was not passed to the provider');
    ok(shortPrompt.includes('English') && /short/i.test(shortPrompt), 'language/length were not passed to the provider');
    ok(/friendly|professional|casual|simple/i.test(shortPrompt), 'writing style was not passed to the provider');

    let hindiPrompt = '';
    const hindiSuccess = await generateReviewSuggestion({
      alias: 'grc-4d7', feedback: 'अच्छा अनुभव', topics: [], language: 'Hindi', length: 'short', ip: '10.88.1.21', userAgent: 'test',
      complet: async (input) => {
        hindiPrompt = `${input.system}\n${input.user}`;
        return { text: 'अच्छा अनुभव।', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      },
    });
    ok(hindiSuccess.ok && hindiSuccess.review === 'अच्छा अनुभव।', 'Hindi generation failed');
    ok(hindiPrompt.includes('Hindi') && hindiPrompt.includes('अच्छा अनुभव'), 'Hindi language/input missing from provider prompt');

    const empty = await generateReviewSuggestion({
      alias: 'grc-4d7', feedback: 'The coffee was good and the staff were very kind.', topics: [], ip: '10.88.1.2', userAgent: 'test',
      complet: async () => ({ text: '   ', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }),
    });
    ok(!empty.ok && empty.code === 'UNAVAILABLE', 'empty provider response became a success');
    const failed = await generateReviewSuggestion({
      alias: 'grc-4d7', feedback: 'The coffee was good and the staff were very kind.', topics: [], ip: '10.88.1.3', userAgent: 'test',
      complet: async () => { throw new Error('provider timeout'); },
    });
    ok(!failed.ok && failed.code === 'UNAVAILABLE', 'provider error became a success');

    const standeeProduct = await resolveStandeeReviewProduct(standees.owner as never);
    ok(standeeProduct, 'Standee product missing');
    const standeeHost = {
      ownerId: String(users.owner._id), hostType: 'standee' as const, hostId: String(standees.owner._id),
      config: { languages: ['English'], writingStyle: 'friendly' as const, preferredLength: 'medium' as const, styleMode: 'fixed' as const, lengthMode: 'fixed' as const },
      feedback: 'The coffee was good and the staff were very kind.', topics: [], ip: '10.88.2.1', userAgent: 'test',
    };
    const standeeSuccess = await generateReviewForHost({
      ...standeeHost,
      complet: async () => ({ text: 'Standee draft', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
    });
    ok(standeeSuccess.ok, 'Standee generation success failed');
    const standeeEmpty = await generateReviewForHost({
      ...standeeHost, ip: '10.88.2.2',
      complet: async () => ({ text: '', usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 } }),
    });
    ok(!standeeEmpty.ok && standeeEmpty.code === 'UNAVAILABLE', 'Standee empty response succeeded');
    const standeeFailed = await generateReviewForHost({
      ...standeeHost, ip: '10.88.2.3',
      complet: async () => { throw new Error('auth failed'); },
    });
    ok(!standeeFailed.ok && standeeFailed.code === 'UNAVAILABLE', 'Standee provider failure succeeded');

    const invalidCard = await api('POST', '/api/public/reviews/grc-4d7/generate', { body: { feedback: 'a' } });
    ok(invalidCard.status === 400, `Card invalid input ${invalidCard.status}`);
    const invalidStandee = await api('POST', '/api/public/standee-reviews/standee-4d7/generate', { body: { feedback: 'a' } });
    ok(invalidStandee.status === 400, `Standee invalid input ${invalidStandee.status}`);
  });

  const passed = results.filter((result) => result.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  if (passed !== results.length) for (const result of results.filter((item) => !item.ok)) console.log(`- ${result.name}: ${result.detail}`);
  await mongoose.disconnect();
  process.exit(results.every((result) => result.ok) ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
