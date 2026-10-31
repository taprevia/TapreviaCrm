/**
 * Phase 4D.9 — historical analytics and deleted-host attribution audit.
 *
 * Read-only analytics assessment over disposable synthetic data:
 *   - active Card/Standee
 *   - inactive Card
 *   - removed-assignment Card (still present)
 *   - deleted Card (events only, no document)
 *   - deleted Standee (events only, no document)
 *   - orphan event without cardId/standeeId
 *   - malformed historical metadata
 *   - mixed-product business
 *   - cross-tenant isolation
 *
 * It asserts the EXISTING semantics only; it never rewrites, restores or
 * deletes historical events, and never invents ownership for orphaned rows.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { getUnifiedReviewAnalytics } from '@/lib/services/review-analytics';

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
const envFile = fs.readFileSync('/Users/prince/Documents/CRM/.env.local', 'utf8');
const envValue = (key: string) => {
  const match = new RegExp(`^${key}=(.*)$`, 'm').exec(envFile);
  return match ? match[1].trim().replace(/^"|"$/g, '') : undefined;
};
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = envValue('JWT_SECRET');
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

const ownerId = oid();
const otherId = oid();
const productId = oid();
const activeCardId = oid();
const inactiveCardId = oid();
const removedCardId = oid();
const deletedCardId = oid();
const deletedStandeeId = oid();
const activeStandeeId = oid();

async function seed() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection not ready');
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }

  await db.collection('users').insertMany([
    { _id: ownerId, name: 'Hist Owner', email: 'owner@hist49.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: otherId, name: 'Hist Other', email: 'other@hist49.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertOne({
    _id: productId, slug: 'google-review-card', name: 'Google Review Card',
    kind: 'review', category: 'card', active: true, createdAt: now, updatedAt: now,
  });
  const card = (id: mongoose.Types.ObjectId, name: string, active: boolean) => ({
    _id: id, cardUid: `H49-${name}`, slug: name, urlAlias: name, routeSlug: name, uid: name,
    name, kind: 'review', userId: ownerId, assignedUserId: ownerId, status: 'active',
    isActive: active, setupComplete: true,
    reviewAssistant: { enabled: true, googleReviewUrl: `https://example.test/${name}`, category: 'cafe' },
    createdAt: now, updatedAt: now,
  });
  await db.collection('cards').insertMany([
    card(activeCardId, 'active-4d9h', true),
    card(inactiveCardId, 'inactive-4d9h', false),
    card(removedCardId, 'removed-4d9h', true),
  ]);
  await db.collection('standees').insertOne({
    _id: activeStandeeId, userId: ownerId, name: 'active-standee-4d9h',
    displayName: 'active-standee-4d9h', routeSlug: 'active-standee-4d9h', uid: 'active-standee-4d9h',
    productKey: 'GOOGLE_REVIEW_STANDEE', maxProfiles: 1, fixedProfiles: ['google_review'],
    panelQr: { qrId: 'panel-hist49', qrColor: '#000000' },
    socialQrs: [{ qrId: 'qr-hist49', platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: 'https://example.test/hist-standee' }],
    createdAt: now, updatedAt: now,
  });
  await db.collection('userproducts').insertMany([
    { _id: oid(), userId: ownerId, catalogProductId: productId, cardId: activeCardId, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: oid(), userId: ownerId, catalogProductId: productId, cardId: inactiveCardId, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
    { _id: oid(), userId: ownerId, catalogProductId: productId, cardId: removedCardId, standeeId: null, quantity: 1, status: 'removed', createdAt: now, updatedAt: now },
    { _id: oid(), userId: ownerId, catalogProductId: productId, cardId: null, standeeId: activeStandeeId, quantity: 1, status: 'active', createdAt: now, updatedAt: now },
  ]);

  const event = (host: { cardId?: mongoose.Types.ObjectId; standeeId?: mongoose.Types.ObjectId }, action: string, metadata: string, ago: number) => ({
    ...(host.cardId ? { cardId: host.cardId } : host.standeeId ? { standeeId: host.standeeId } : {}),
    action, metadata, createdAt: daysAgo(ago), updatedAt: daysAgo(ago),
  });
  const ai = JSON.stringify({ source: 'ai' });
  const manual = JSON.stringify({ source: 'manual' });
  await db.collection('analyticslogs').insertMany([
    // Active Card: 2 views, AI copy + malformed historical copy.
    event({ cardId: activeCardId }, 'review_page_view', '', 1),
    event({ cardId: activeCardId }, 'review_page_view', '', 2),
    event({ cardId: activeCardId }, 'review_copied', ai, 1),
    event({ cardId: activeCardId }, 'review_copied', 'legacy-free-form', 2),
    // Inactive Card: still attributable because the document exists.
    event({ cardId: inactiveCardId }, 'review_page_view', '', 1),
    // Removed assignment: still attributable as historical.
    event({ cardId: removedCardId }, 'review_page_view', '', 2),
    event({ cardId: removedCardId }, 'review_copied', manual, 2),
    // Deleted Card: events remain but the host document is gone.
    event({ cardId: deletedCardId }, 'review_page_view', '', 1),
    event({ cardId: deletedCardId }, 'review_page_view', '', 2),
    event({ cardId: deletedCardId }, 'review_page_view', '', 3),
    event({ cardId: deletedCardId }, 'review_copied', ai, 1),
    event({ cardId: deletedCardId }, 'review_copied', ai, 2),
    // Deleted Standee: same limitation.
    event({ standeeId: deletedStandeeId }, 'review_page_view', '', 1),
    event({ standeeId: deletedStandeeId }, 'review_page_view', '', 2),
    // Active Standee: attributable.
    event({ standeeId: activeStandeeId }, 'review_page_view', '', 1),
    // Orphan with no host identifier.
    { action: 'review_page_view', metadata: '', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
    // Other tenant.
    event({ cardId: oid() }, 'review_page_view', '', 1),
    event({ cardId: oid() }, 'review_copied', ai, 1),
  ]);

  await db.collection('reviewrotationevents').insertMany([
    { _id: oid(), businessId: ownerId, categoryKey: 'cafe', templateId: oid(), cycle: 0, copyId: 'rot-active-49', cardId: activeCardId, copiedAt: daysAgo(1), createdAt: daysAgo(1), updatedAt: daysAgo(1) },
    // Deleted hosts still carry a trustworthy businessId in rotation events.
    { _id: oid(), businessId: ownerId, categoryKey: 'cafe', templateId: oid(), cycle: 1, copyId: 'rot-deleted-card-49', cardId: deletedCardId, copiedAt: daysAgo(2), createdAt: daysAgo(2), updatedAt: daysAgo(2) },
    { _id: oid(), businessId: ownerId, categoryKey: 'cafe', templateId: oid(), cycle: 2, copyId: 'rot-deleted-standee-49', standeeId: deletedStandeeId, copiedAt: daysAgo(3), createdAt: daysAgo(3), updatedAt: daysAgo(3) },
    { _id: oid(), businessId: otherId, categoryKey: 'cafe', templateId: oid(), cycle: 0, copyId: 'rot-other-49', cardId: oid(), copiedAt: daysAgo(1), createdAt: daysAgo(1), updatedAt: daysAgo(1) },
  ]);
}

async function analytics(userId: string, hostKey?: string) {
  const result = await getUnifiedReviewAnalytics({ userId, range: '30d', hostKey: hostKey ?? 'all' });
  ok(result.ok, `analytics failed for ${userId}`);
  return result.data;
}

async function main() {
  await seed();
  const db = mongoose.connection.db!;
  const owner = await analytics(String(ownerId));

  await check('1. analytics events carry no persisted businessId', async () => {
    const count = await db.collection('analyticslogs').countDocuments({ businessId: { $exists: true } });
    ok(count === 0, `${count} analytics events unexpectedly carry businessId`);
  });

  await check('2. active/inactive/removed hosts remain attributable', async () => {
    const titles = owner.products.map((row) => row.title);
    ok(titles.includes('active-4d9h'), 'active Card missing');
    ok(titles.includes('inactive-4d9h'), 'inactive Card missing');
    ok(titles.includes('removed-4d9h'), 'removed-assignment Card missing');
    const removed = owner.products.find((row) => row.title === 'removed-4d9h');
    ok(removed && removed.active === false, 'removed-assignment host should be historical');
    const inactive = owner.products.find((row) => row.title === 'inactive-4d9h');
    ok(inactive && inactive.active === true, 'inactive document should remain active in analytics');
  });

  await check('3. deleted Card/Standee documents are excluded from totals', async () => {
    ok(owner.totals.visits === 5, `visits ${owner.totals.visits}`);
    ok(owner.totals.totalCopies === 3, `copies ${owner.totals.totalCopies}`);
    ok(owner.totals.aiCopies === 1, `ai ${owner.totals.aiCopies}`);
    ok(owner.totals.manualCopies === 1, `manual ${owner.totals.manualCopies}`);
    ok(owner.totals.unclassifiedCopies === 1, `unclassified ${owner.totals.unclassifiedCopies}`);
    const titles = owner.products.map((row) => row.title);
    ok(!titles.some((title) => title.includes(String(deletedCardId))), 'deleted Card was invented as a product row');
    ok(!titles.some((title) => title.includes(String(deletedStandeeId))), 'deleted Standee was invented as a product row');
  });

  await check('4. raw deleted-host events are preserved, not deleted or rewritten', async () => {
    const deletedCardEvents = await db.collection('analyticslogs').countDocuments({ cardId: deletedCardId });
    const deletedStandeeEvents = await db.collection('analyticslogs').countDocuments({ standeeId: deletedStandeeId });
    ok(deletedCardEvents === 5, `deleted Card events ${deletedCardEvents}`);
    ok(deletedStandeeEvents === 2, `deleted Standee events ${deletedStandeeEvents}`);
    const total = await db.collection('analyticslogs').countDocuments({ action: { $in: ['review_page_view', 'review_copied'] } });
    ok(total === 18, `raw review events ${total}`);
  });

  await check('5. orphan event without host identity is never guessed', async () => {
    const orphan = await db.collection('analyticslogs').findOne({ action: 'review_page_view', metadata: '', cardId: { $exists: false }, standeeId: { $exists: false } });
    ok(orphan, 'orphan fixture missing');
    // 5 attributable visits (2 active + 1 inactive + 1 removed + 1 standee).
    ok(owner.totals.visits === 5, `orphan visit leaked into totals: ${owner.totals.visits}`);
  });

  await check('6. malformed historical metadata stays unclassified', async () => {
    ok(owner.totals.unclassifiedCopies === 1, 'malformed metadata misclassified');
    ok(owner.totals.aiCopies === 1 && owner.totals.manualCopies === 1, 'AI/manual classification changed');
  });

  await check('7. rotation business totals include deleted hosts, product rows do not', async () => {
    // Existing semantics: rotation events persist businessId, so the business
    // rotation total includes deleted hosts, but they cannot be product-scoped.
    ok(owner.totals.rotationCopies === 3, `rotation total ${owner.totals.rotationCopies}`);
    const activeRow = owner.products.find((row) => row.title === 'active-4d9h');
    ok(activeRow && activeRow.rotationCopies === 1, `active rotation ${activeRow?.rotationCopies}`);
    const filtered = await analytics(String(ownerId), `card:${String(activeCardId)}`);
    ok(filtered.totals.rotationCopies === 1, `filtered rotation ${filtered.totals.rotationCopies}`);
  });

  await check('8. mixed-product totals and tenant isolation hold', async () => {
    ok(owner.products.length === 4, `product rows ${owner.products.length}`);
    const other = await analytics(String(otherId));
    ok(other.totals.visits <= 1, `other visits ${other.totals.visits}`);
    const crossHost = await getUnifiedReviewAnalytics({ userId: String(otherId), range: '30d', hostKey: `card:${String(activeCardId)}` });
    ok(!crossHost.ok && crossHost.code === 'INVALID_HOST', 'cross-tenant host filter accepted');
  });

  await check('9. deleted-host copy is never reclassified as a posted review', async () => {
    const deletedCopies = await db.collection('analyticslogs').countDocuments({ cardId: deletedCardId, action: 'review_copied' });
    ok(deletedCopies === 2, `deleted copies ${deletedCopies}`);
    const posted = await db.collection('analyticslogs').countDocuments({ action: /google|posted/i });
    ok(posted === 0, 'a reviewed copy was recorded as a posted Google review');
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
