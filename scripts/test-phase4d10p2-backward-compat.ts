/**
 * Phase 4D.10 Gate P2.7 — backward-compatibility certification.
 *
 * Seeds representative legacy + new records, snapshots every relevant
 * collection, exercises the unified review/preview/entitlement resolvers and
 * analytics reads, then re-snapshots to prove no record was mutated.
 *
 * Run with flags OFF and with CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED=true:
 *   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p27_compat \
 *   npx tsx scripts/test-phase4d10p2-backward-compat.ts
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import ReviewSettings from '@/models/ReviewSettings';
import { resolveReviewSettings } from '@/lib/services/review-settings-resolver';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolveCardPreview, resolveStandeePreview } from '@/lib/services/product-preview';
import { resolveCardDestination } from '@/lib/services/redirect-target';
import { permanentCardUrl } from '@/lib/admin-card-view';
import { resolveStandeeEffectiveReviewSettings } from '@/lib/services/review-standee-settings';
import { getUnifiedReviewAnalytics } from '@/lib/services/review-analytics';
import { listEligibleReviewProducts } from '@/lib/services/review-product-eligibility';

const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('taprevia_p27_')) {
  console.error(`Refusing to run: MONGODB_DB must start with taprevia_p27_ (got "${DB_NAME}")`);
  process.exit(2);
}
const CENTRAL = process.env.CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED === 'true';

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

const COLLECTIONS = [
  'users', 'profiles', 'catalogproducts', 'cards', 'standees', 'userproducts',
  'reviewsettings', 'reviewcategories', 'reviewtemplates', 'reviewrotationevents',
  'reviewrotationstates', 'analyticslogs',
] as const;

async function snapshot(db: NonNullable<typeof mongoose.connection.db>) {
  const out: Record<string, string> = {};
  for (const name of COLLECTIONS) {
    const rows = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
    out[name] = JSON.stringify(rows);
  }
  return out;
}

interface Fixtures { cards: Record<string, Record<string, unknown>>; standees: Record<string, Record<string, unknown>>; users: Record<string, mongoose.Types.ObjectId>; }

async function seed(): Promise<Fixtures> {
  await connectDB();
  const db = mongoose.connection.db!;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!collection.name.startsWith('system.')) await db.collection(collection.name).deleteMany({});
  }
  const owner = oid();
  const other = oid();
  const premium = oid();
  const grc = oid();
  const business = oid();
  const standeeProduct = oid();
  const cards: Record<string, Record<string, unknown>> = {};
  function card(key: string, extra: Record<string, unknown>) {
    const id = oid();
    const doc: Record<string, unknown> = {
      _id: id, cardUid: `P27-${key.toUpperCase()}`, slug: key, urlAlias: key, name: key,
      kind: 'review', userId: owner, assignedUserId: owner, status: 'active', isActive: true,
      setupComplete: true, reviewAssistant: { enabled: true, googleReviewUrl: `https://example.test/${key}` },
      createdAt: now, updatedAt: now, ...extra,
    };
    if (doc.publicSlug === '') delete doc.publicSlug;
    cards[key] = doc;
    return id;
  }
  // Legacy review record: no publicSlug/category/style/length; missing optional fields.
  card('legacy-review', { routeSlug: 'legacy-route-p27', uid: 'legacy-route-p27' });
  // New review record with all modern fields.
  card('new-review', {
    routeSlug: 'new-route-p27', uid: 'new-route-p27', publicSlug: 'acme/new-review',
    reviewAssistant: {
      enabled: true, googleReviewUrl: 'https://example.test/new-review',
      welcomeMessage: 'Welcome', category: 'cafe', languages: ['English', 'Hindi'],
      writingStyle: 'friendly', preferredLength: 'medium', feedbackTopics: ['Service'],
      employees: [], services: [], keywords: [],
    },
  });
  // Central record: legacy disabled, central enabled.
  card('central-review', {
    routeSlug: 'central-route-p27', reviewSettingsSource: 'central',
    reviewAssistant: { enabled: false, googleReviewUrl: '' },
  });
  // Hybrid record: central + explicit overrides.
  card('hybrid-review', {
    routeSlug: 'hybrid-route-p27', reviewSettingsSource: 'hybrid',
    reviewOverrides: { welcomeMessage: 'Hybrid welcome', googleReviewUrl: 'https://example.test/hybrid-override' },
  });
  // Legacy profile Card with no review settings and only an alias.
  card('legacy-profile', { kind: 'profile', reviewAssistant: undefined, urlAlias: 'legacy-profile' });
  cards['legacy-profile'].slug = 'legacy-profile';
  // Lower-tier review Card (business product) must stay denied.
  card('lower-review', { reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/lower' } });
  // Zero-assignment legacy review Card (owner has premium capability separately).
  const zeroReview = card('zero-review', { reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/zero' } });

  const standee = oid();
  const standeeDoc = {
    _id: standee, userId: owner, name: 'P27 Standee', displayName: 'P27 Standee',
    routeSlug: 'p27-standee', uid: 'p27-standee', publicSlug: 'p27/standee',
    productKey: 'GOOGLE_REVIEW_STANDEE', maxProfiles: 2, fixedProfiles: ['google_review', 'instagram'],
    panelQr: { qrId: 'panel-p27', qrColor: '#000000' },
    socialQrs: [
      { qrId: 'qr-p27-google', platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: 'https://example.test/p27-google' },
      { qrId: 'qr-p27-insta', platform: 'instagram', label: 'Instagram', qrColor: '#000000', destinationUrl: 'https://example.test/p27-insta' },
    ],
    createdAt: now, updatedAt: now,
  };

  await db.collection('users').insertMany([
    { _id: owner, name: 'Owner', email: 'owner@p27.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: other, name: 'Other', email: 'other@p27.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);
  await db.collection('profiles').insertMany([
    { _id: oid(), userId: owner, companyInfo: { companyName: 'P27 Owner Co' }, socialLinks: [], createdAt: now, updatedAt: now },
    { _id: oid(), userId: other, companyInfo: { companyName: 'P27 Other Co' }, socialLinks: [], createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertMany([
    { _id: premium, slug: 'premium-nfc-card', name: 'Premium NFC Card', kind: 'profile', category: 'card', active: true, createdAt: now, updatedAt: now },
    { _id: grc, slug: 'google-review-card', name: 'Google Review Card', kind: 'review', category: 'card', active: true, createdAt: now, updatedAt: now },
    { _id: business, slug: 'business-nfc-card', name: 'Business NFC Card', kind: 'profile', category: 'card', active: true, createdAt: now, updatedAt: now },
    { _id: standeeProduct, slug: 'google-review-standee', name: 'Google Review Standee', kind: 'standee', category: 'standee', active: true, createdAt: now, updatedAt: now },
  ]);
  await db.collection('cards').insertMany(Object.values(cards));
  await db.collection('standees').insertOne(standeeDoc);
  const assign = (key: string, product: mongoose.Types.ObjectId, cardId?: mongoose.Types.ObjectId, standeeId?: mongoose.Types.ObjectId) => ({
    _id: oid(), userId: owner, catalogProductId: product, cardId: cardId ?? null, standeeId: standeeId ?? null,
    quantity: 1, status: 'active', createdAt: now, updatedAt: now,
  });
  await db.collection('userproducts').insertMany([
    assign('premium', premium),
    assign('grc', grc, cards['legacy-review']._id as mongoose.Types.ObjectId),
    assign('new', grc, cards['new-review']._id as mongoose.Types.ObjectId),
    assign('central', grc, cards['central-review']._id as mongoose.Types.ObjectId),
    assign('hybrid', grc, cards['hybrid-review']._id as mongoose.Types.ObjectId),
    assign('profile', premium, cards['legacy-profile']._id as mongoose.Types.ObjectId),
    assign('lower', business, cards['lower-review']._id as mongoose.Types.ObjectId),
    assign('standee', standeeProduct, undefined, standee),
  ]);
  // zeroReview intentionally has no assignment; owner premium grants legacy review-host access.
  void zeroReview;
  await db.collection('reviewcategories').insertOne({
    _id: oid(), key: 'cafe', name: 'Cafe', active: true, languages: ['English', 'Hindi'],
    scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now,
  });
  await db.collection('reviewtemplates').insertMany([
    { _id: oid(), key: 'p27-1', categoryKey: 'cafe', scenario: 'service', language: 'English', text: 'Short {businessName}.', length: 'short', style: 'friendly', variables: [], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
    { _id: oid(), key: 'p27-2', categoryKey: 'cafe', scenario: 'service', language: 'Hindi', text: 'छोटा {businessName}.', length: 'short', style: 'friendly', variables: [], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
  ]);
  await db.collection('reviewsettings').insertOne({
    businessId: owner, schemaVersion: 1,
    general: { enabled: true, googleReviewUrl: 'https://example.test/central-p27', welcomeMessage: 'Central welcome' },
    content: { category: 'cafe', languages: ['English', 'Hindi'], writingStyle: 'friendly', preferredLength: 'medium', styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: ['Service'], services: [], employees: [], keywords: [] },
    updatedBy: owner, createdAt: now, updatedAt: now, __v: 0,
  });
  await db.collection('analyticslogs').insertMany([
    { cardId: cards['legacy-review']._id, action: 'review_page_view', metadata: '', createdAt: now, updatedAt: now },
    { cardId: cards['legacy-review']._id, action: 'review_copied', metadata: JSON.stringify({ source: 'ai' }), createdAt: now, updatedAt: now },
    { cardId: oid(), action: 'review_page_view', metadata: '', createdAt: now, updatedAt: now },
  ]);
  await db.collection('reviewrotationevents').insertOne({
    _id: oid(), businessId: owner, categoryKey: 'cafe', templateId: oid(), cycle: 0,
    copyId: 'p27-rotation', cardId: cards['legacy-review']._id, copiedAt: now, createdAt: now, updatedAt: now,
  });
  await db.collection('reviewrotationstates').insertOne({
    _id: oid(), businessId: owner, categoryKey: 'cafe', cycle: 0, usedTemplateIds: [],
    lastResetBy: null, lastResetReason: '', lastResetAt: null, createdAt: now, updatedAt: now,
  });
  return { cards, standees: { owner: standeeDoc as Record<string, unknown> }, users: { owner, other } };
}

async function main() {
  const fx = await seed();
  const db = mongoose.connection.db!;
  const before = await snapshot(db);

  await check('legacy resolver keeps the exact stored Google URL', async () => {
    const resolved = await resolveEffectiveReviewSettings(fx.cards['legacy-review'] as never);
    assert.equal(resolved.googleReviewUrl, 'https://example.test/legacy-review');
    assert.equal(resolved.enabled, true);
  });
  await check('central resolver reads central only when the public gate is ON', async () => {
    const resolved = await resolveEffectiveReviewSettings(fx.cards['central-review'] as never);
    if (CENTRAL) {
      assert.equal(resolved.googleReviewUrl, 'https://example.test/central-p27');
      assert.equal(resolved.enabled, true);
    } else {
      assert.equal(resolved.enabled, false);
    }
  });
  await check('hybrid overrides win without rewriting central or legacy storage', () => {
    const resolved = resolveReviewSettings({
      card: { reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/legacy-hybrid' } },
      source: 'hybrid',
      centralSettings: { schemaVersion: 1, general: { enabled: true, googleReviewUrl: 'https://example.test/central-p27' }, content: { category: 'cafe', languages: ['English'] } },
      overrides: { welcomeMessage: 'Hybrid welcome', googleReviewUrl: 'https://example.test/hybrid-override' },
    });
    assert.equal(resolved.googleReviewUrl, 'https://example.test/hybrid-override');
    assert.equal(resolved.welcomeMessage, 'Hybrid welcome');
  });
  await check('legacy review Card remains entitled; lower-tier remains denied', async () => {
    const legacy = await getCardReviewEntitlement(fx.cards['legacy-review'] as never);
    const lower = await getCardReviewEntitlement(fx.cards['lower-review'] as never);
    const zero = await getCardReviewEntitlement(fx.cards['zero-review'] as never);
    assert.equal(legacy.entitled, true);
    assert.equal(lower.entitled, false);
    assert.equal(zero.entitled, true); // legacy review host + premium capability
  });
  await check('preview resolver preserves existing identifiers and routes', async () => {
    const legacy = await resolveCardPreview(fx.cards['legacy-review'] as never);
    const newCard = await resolveCardPreview(fx.cards['new-review'] as never);
    const profile = await resolveCardPreview(fx.cards['legacy-profile'] as never);
    assert.deepEqual(legacy, { ok: true, kind: 'review', href: '/review/legacy-review' });
    assert.deepEqual(newCard, { ok: true, kind: 'review', href: '/review/new-review' });
    assert.deepEqual(profile, { ok: true, kind: 'profile', href: '/profile/legacy-profile' });
  });
  await check('destination resolver preserves review/profile routing', () => {
    assert.equal(resolveCardDestination({ kind: 'review', urlAlias: 'legacy-review' }), '/review/legacy-review');
    assert.equal(resolveCardDestination({ kind: 'profile', urlAlias: 'legacy-profile' }), '/profile/legacy-profile?src=qr');
    assert.equal(permanentCardUrl({ routeSlug: 'legacy-route-p27' }, 'https://taprev.in'), 'https://taprev.in/r/legacy-route-p27');
    assert.equal(permanentCardUrl({ slug: 'legacy-review' }, 'https://taprev.in'), 'https://taprev.in/c/legacy-review');
  });
  await check('Standee settings and preview keep the original destination', async () => {
    const settings = resolveStandeeEffectiveReviewSettings({
      standee: fx.standees.owner as never,
      googleReviewUrl: 'https://example.test/p27-google',
      source: 'legacy',
    });
    assert.equal(settings.googleReviewUrl, 'https://example.test/p27-google');
    const preview = await resolveStandeePreview(fx.standees.owner as never);
    assert.ok(preview.ok);
  });
  await check('eligible products include legacy/new Cards and Standee, exclude lower-tier', async () => {
    const products = await listEligibleReviewProducts(String(fx.users.owner));
    const cardAliases = products.filter((p) => p.instanceType === 'card').map((p) => p.cardId);
    assert.ok(cardAliases.includes(String(fx.cards['legacy-review']._id)));
    assert.ok(cardAliases.includes(String(fx.cards['new-review']._id)));
    assert.ok(products.some((p) => p.instanceType === 'standee'));
    assert.ok(!cardAliases.includes(String(fx.cards['lower-review']._id)));
  });
  await check('historical analytics remain readable and tenant-scoped', async () => {
    const owner = await getUnifiedReviewAnalytics({ userId: String(fx.users.owner), range: '30d', hostKey: 'all' });
    assert.ok(owner.ok);
    if (owner.ok) {
      assert.equal(owner.data.totals.visits, 1);
      assert.equal(owner.data.totals.aiCopies, 1);
    }
    const other = await getUnifiedReviewAnalytics({ userId: String(fx.users.other), range: '30d', hostKey: 'all' });
    assert.ok(other.ok);
    if (other.ok) assert.equal(other.data.totals.visits, 0);
  });
  await check('read-only resolution did not mutate any collection', async () => {
    const after = await snapshot(db);
    for (const name of COLLECTIONS) {
      assert.equal(after[name], before[name], `${name} changed during read-only resolution`);
    }
  });
  await check('identifier and destination snapshot is unchanged', async () => {
    const cards = await db.collection('cards').find({}).sort({ _id: 1 }).toArray();
    const legacy = cards.find((c) => c.urlAlias === 'legacy-review')!;
    assert.equal(legacy.cardUid, 'P27-LEGACY-REVIEW');
    assert.equal(legacy.routeSlug, 'legacy-route-p27');
    assert.equal((legacy.reviewAssistant as { googleReviewUrl?: string }).googleReviewUrl, 'https://example.test/legacy-review');
    const standee = await db.collection('standees').findOne({ routeSlug: 'p27-standee' })!;
    assert.equal(standee!.routeSlug, 'p27-standee');
    assert.equal((standee!.socialQrs as Array<{ destinationUrl?: string }>)[0].destinationUrl, 'https://example.test/p27-google');
  });

  console.log(`\n${results.length}/${results.length + failed} checks passed (central=${CENTRAL})`);
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
