/**
 * Phase 4D.10 Gate P2.4 addendum — authoritative preview resolver tests.
 *
 * Uses a disposable local database. Verifies profile/review/social/standee
 * preview resolution, entitlement, effective central settings and setup states.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import ReviewSettings from '@/models/ReviewSettings';
import {
  resolveCardPreview,
  resolveStandeePreview,
  resolveProductUrls,
  permanentEntryPath,
} from '@/lib/services/product-preview';

const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('taprevia_p24_')) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_p24_ (got "${DB_NAME}")`);
  process.exit(2);
}

const oid = () => new mongoose.Types.ObjectId();
const now = new Date();
const results: string[] = [];
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(name);
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function seed() {
  await connectDB();
  const db = mongoose.connection.db!;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }
  const premiumUser = oid();
  const lowerUser = oid();
  const premiumProduct = oid();
  const grcProduct = oid();
  const businessProduct = oid();
  const cards: Record<string, Record<string, unknown>> = {};
  const card = (key: string, kind: string, extra: Record<string, unknown>) => {
    const id = oid();
    const doc: Record<string, unknown> = {
      _id: id, cardUid: `P24-${key.toUpperCase()}`, slug: key, urlAlias: key, name: key,
      kind, userId: premiumUser, assignedUserId: premiumUser, status: 'active', isActive: true,
      setupComplete: true, reviewAssistant: { enabled: false, googleReviewUrl: '' },
      createdAt: now, updatedAt: now, ...extra,
    };
    // Sparse unique publicSlug must be absent, not an empty string.
    if (doc.publicSlug === '') delete doc.publicSlug;
    cards[key] = doc;
    return id;
  };
  card('profile-public', 'profile', { publicSlug: 'acme/premium' });
  card('profile-alias', 'profile', { publicSlug: '' });
  card('profile-slug', 'profile', { publicSlug: '', urlAlias: '' });
  card('review-legacy', 'review', {
    reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/legacy' },
  });
  card('review-central', 'review', {
    reviewSettingsSource: 'central',
    reviewAssistant: { enabled: false, googleReviewUrl: '' },
  });
  card('review-disabled', 'review', {
    reviewAssistant: { enabled: false, googleReviewUrl: '' },
  });
  card('review-noalias', 'review', { urlAlias: '' });
  card('review-lower', 'review', {
    userId: lowerUser, assignedUserId: lowerUser,
    reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/lower' },
  });
  card('social-ok', 'social', { redirectUrl: 'https://example.test/social' });
  card('social-missing', 'social', { redirectUrl: '' });
  card('review-second', 'review', {
    reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/second' },
  });

  await db.collection('users').insertMany([
    { _id: premiumUser, name: 'Premium', email: 'premium@p24.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: lowerUser, name: 'Lower', email: 'lower@p24.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertMany([
    { _id: premiumProduct, slug: 'premium-nfc-card', name: 'Premium NFC Card', kind: 'profile', category: 'card', active: true, createdAt: now, updatedAt: now },
    { _id: grcProduct, slug: 'google-review-card', name: 'Google Review Card', kind: 'review', category: 'card', active: true, createdAt: now, updatedAt: now },
    { _id: businessProduct, slug: 'business-nfc-card', name: 'Business NFC Card', kind: 'profile', category: 'card', active: true, createdAt: now, updatedAt: now },
  ]);
  await db.collection('cards').insertMany(Object.values(cards));
  const assign = (cardKey: string, userId: mongoose.Types.ObjectId, productId: mongoose.Types.ObjectId, status = 'active') => ({
    _id: oid(), userId, catalogProductId: productId, cardId: cards[cardKey]._id, standeeId: null,
    quantity: 1, status, createdAt: now, updatedAt: now,
  });
  await db.collection('userproducts').insertMany([
    assign('profile-public', premiumUser, premiumProduct),
    assign('profile-alias', premiumUser, premiumProduct),
    assign('profile-slug', premiumUser, premiumProduct),
    assign('review-legacy', premiumUser, grcProduct),
    assign('review-central', premiumUser, grcProduct),
    assign('review-disabled', premiumUser, grcProduct),
    assign('review-second', premiumUser, grcProduct),
    assign('review-lower', lowerUser, businessProduct),
  ]);
  await ReviewSettings.create({
    businessId: premiumUser,
    schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: 'https://example.test/central', welcomeMessage: 'Central' },
    content: {
      category: 'cafe', languages: ['English'], writingStyle: 'friendly', preferredLength: 'medium',
      styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [],
    },
    updatedBy: premiumUser,
  });
  return cards;
}

async function main() {
  const cards = await seed();

  await check('profile card prefers publicSlug', async () => {
    const r = await resolveCardPreview(cards['profile-public'] as never);
    assert.deepEqual(r, { ok: true, kind: 'profile', href: '/acme/premium' });
  });
  await check('profile alias fallback', async () => {
    const r = await resolveCardPreview(cards['profile-alias'] as never);
    assert.deepEqual(r, { ok: true, kind: 'profile', href: '/profile/profile-alias' });
  });
  await check('profile legacy slug fallback', async () => {
    const r = await resolveCardPreview(cards['profile-slug'] as never);
    assert.deepEqual(r, { ok: true, kind: 'profile', href: '/c/profile-slug' });
  });
  await check('legacy enabled review card → /review/{alias}', async () => {
    const r = await resolveCardPreview(cards['review-legacy'] as never);
    assert.deepEqual(r, { ok: true, kind: 'review', href: '/review/review-legacy' });
  });
  await check('central card with the public integration gate OFF stays setup-required', async () => {
    // Public central reads are gated; with the gate OFF the effective public
    // settings remain legacy (disabled), so preview must not fake a live page.
    const r = await resolveCardPreview(cards['review-central'] as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'disabled');
  });
  await check('disabled review card returns a setup state, not a dead preview', async () => {
    const r = await resolveCardPreview(cards['review-disabled'] as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'disabled');
  });
  await check('missing alias returns setup state', async () => {
    const r = await resolveCardPreview(cards['review-noalias'] as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'missing-alias');
  });
  await check('lower-tier review card is not previewable', async () => {
    const r = await resolveCardPreview(cards['review-lower'] as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not-entitled');
  });
  await check('two review cards resolve to distinct preview URLs', async () => {
    const a = await resolveCardPreview(cards['review-legacy'] as never);
    const b = await resolveCardPreview(cards['review-second'] as never);
    assert.ok(a.ok && b.ok);
    assert.notEqual(a.href, b.href);
  });
  await check('social card uses its safe destination', async () => {
    const r = await resolveCardPreview(cards['social-ok'] as never);
    assert.deepEqual(r, { ok: true, kind: 'social', href: 'https://example.test/social' });
  });
  await check('social card without destination returns setup state', async () => {
    const r = await resolveCardPreview(cards['social-missing'] as never);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'missing-destination');
  });
  await check('missing instance returns setup state', async () => {
    const r = await resolveCardPreview(null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'missing-instance');
  });
  await check('standee gate OFF preserves the public panel preview', async () => {
    const r = await resolveStandeePreview({ routeSlug: 'standee-1', publicSlug: 'acme/standee' });
    assert.deepEqual(r, { ok: true, kind: 'standee', href: '/acme/standee' });
  });

  await check('permanent entry path preserves route identifiers', async () => {
    assert.equal(permanentEntryPath('card', { routeSlug: 'route-a' }), '/r/route-a');
    assert.equal(permanentEntryPath('card', { slug: 'legacy-slug' }), '/c/legacy-slug');
    assert.equal(permanentEntryPath('standee', { routeSlug: 'standee-a' }), '/r/standee-a');
    assert.equal(permanentEntryPath('standee', { panelQr: { qrId: 'panel-a' } }), '/qr/panel-a');
  });
  await check('unified URL metadata separates canonical and permanent', async () => {
    const review = await resolveProductUrls({
      instanceType: 'card',
      instance: cards['review-legacy'] as never,
    });
    assert.equal(review.canonicalPublicUrl, '/review/review-legacy');
    assert.equal(review.permanentEntryUrl, '/c/review-legacy');
    assert.equal(review.previewUrl, '/review/review-legacy');
    assert.equal(review.routeSource, 'review');
    assert.equal(review.configurationStatus, 'ready');
    const profile = await resolveProductUrls({
      instanceType: 'card',
      instance: cards['profile-slug'] as never,
    });
    assert.equal(profile.canonicalPublicUrl, '/c/profile-slug');
    assert.equal(profile.permanentEntryUrl, '/c/profile-slug');
    const missing = await resolveProductUrls({ instanceType: null, instance: null });
    assert.equal(missing.configurationStatus, 'unassigned');
    assert.equal(missing.canonicalPublicUrl, null);
  });

  console.log(`\n${results.length}/${results.length + failed} checks passed`);
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
