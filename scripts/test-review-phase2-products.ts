/**
 * Phase 2 review product eligibility/routing regression.
 *
 * Run with STANDEE_REVIEW_ASSISTANT_ENABLED=true and a disposable p39 DB:
 *   STANDEE_REVIEW_ASSISTANT_ENABLED=true \
 *   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p39_review \
 *   npx tsx scripts/test-review-phase2-products.ts
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { seed } from './test-phase4d10p3-write-api';
import { connectDB } from '@/lib/db';
import { listEligibleReviewProducts, getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import { resolveCardDestination } from '@/lib/services/redirect-target';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { resolveReviewSettings } from '@/lib/services/review-settings-resolver';
import { resolveEntitlement } from '@/lib/services/capability-access';

const OWNER = '000000000000000000000002';
const OTHER = '000000000000000000000003';
const PREMIUM_ASSIGN = '000000000000000000000401';
const BIZ_ASSIGN = '000000000000000000000402';
const ALL3_ASSIGN = '000000000000000000000703';
const ALL4_ASSIGN = '000000000000000000000713';
const LEGACY_USER = '000000000000000000000008';
const LEGACY_CATALOG = '000000000000000000000721';
const LEGACY_CONFIGURED_CARD = '000000000000000000000722';
const LEGACY_UNCONFIGURED_CARD = '000000000000000000000723';
const LEGACY_CONFIGURED_ASSIGN = '000000000000000000000724';
const LEGACY_SLUG_ONLY_CARD = '000000000000000000000727';
const LEGACY_SLUG_ONLY_ASSIGN = '000000000000000000000728';
const CANONICAL_UNCONFIGURED_CARD = '000000000000000000000730';
const CANONICAL_UNCONFIGURED_ASSIGN = '000000000000000000000731';
const LEGACY_UNCONFIGURED_ASSIGN = '000000000000000000000725';
const ALL3_STANDEE = '000000000000000000000702';
const ALL4_STANDEE = '000000000000000000000712';

const results: Array<{ name: string; pass: boolean; evidence: string }> = [];
function check(name: string, pass: boolean, evidence: string) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${evidence}`);
}

async function addStandeeProduct(catalogId: string, standeeId: string, assignmentId: string, slug: string, profiles: number) {
  const db = mongoose.connection.db!;
  const now = new Date();
  await db.collection('catalogproducts').insertOne({
    _id: new mongoose.Types.ObjectId(catalogId),
    slug,
    name: profiles === 3 ? 'All In One Standee - 3 Profile' : 'All In One Standee - 4 Profile',
    category: 'standee',
    kind: 'standee',
    active: true,
    priceMinor: 0,
    sortOrder: 20,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('standees').insertOne({
    _id: new mongoose.Types.ObjectId(standeeId),
    userId: new mongoose.Types.ObjectId(OWNER),
    name: `P39 ${slug}`,
    displayName: `P39 ${slug}`,
    routeSlug: `p39-${slug}`,
    uid: `p39-${slug}`,
    publicSlug: `p39/${slug}`,
    productKey: slug.toUpperCase().replace(/-/g, '_'),
    maxProfiles: profiles,
    fixedProfiles: ['google_review', 'instagram', 'facebook', 'whatsapp'].slice(0, profiles),
    panelQr: { qrId: `panel-${slug}`, qrColor: '#000000' },
    socialQrs: [
      { qrId: `google-${slug}`, platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: `https://example.test/${slug}-google` },
      { qrId: `instagram-${slug}`, platform: 'instagram', label: 'Instagram', qrColor: '#000000', destinationUrl: `https://example.test/${slug}-instagram` },
      { qrId: `facebook-${slug}`, platform: 'facebook', label: 'Facebook', qrColor: '#000000', destinationUrl: `https://example.test/${slug}-facebook` },
      { qrId: `whatsapp-${slug}`, platform: 'whatsapp', label: 'WhatsApp', qrColor: '#000000', destinationUrl: `https://example.test/${slug}-whatsapp` },
    ].slice(0, profiles),
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('userproducts').insertOne({
    _id: new mongoose.Types.ObjectId(assignmentId),
    userId: new mongoose.Types.ObjectId(OWNER),
    catalogProductId: new mongoose.Types.ObjectId(catalogId),
    cardId: null,
    standeeId: new mongoose.Types.ObjectId(standeeId),
    quantity: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
}

async function main() {
  if (!process.env.MONGODB_DB?.includes('p39')) throw new Error('Refusing non-p39 DB');
  await seed();
  await connectDB();
  const db = mongoose.connection.db!;
  await db.collection('cards').updateOne(
    { _id: new mongoose.Types.ObjectId('000000000000000000000201') },
    { $set: { reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/premium-google', writingStyle: 'friendly', preferredLength: 'medium', languages: ['English'], feedbackTopics: [], welcomeMessage: '', category: 'cafe', employees: [], services: [], keywords: [] } } }
  );
  await addStandeeProduct('000000000000000000000701', ALL3_STANDEE, ALL3_ASSIGN, 'all-in-one-standee-3', 3);
  await addStandeeProduct('000000000000000000000711', ALL4_STANDEE, ALL4_ASSIGN, 'all-in-one-standee-4', 4);

  // Historical Premium identity: catalog slug `premium-card` (human public
  // path) predates the canonical `premium-nfc-card` slug. This user has ONLY
  // that legacy assignment; entitlement and review eligibility must still work.
  {
    const now = new Date();
    const db2 = mongoose.connection.db!;
    await db2.collection('users').insertOne({
      _id: new mongoose.Types.ObjectId(LEGACY_USER),
      name: 'Legacy Premium User',
      email: 'legacy-premium@p39.test',
      role: 'customer',
      status: 'active',
      passwordHash: 'x'.repeat(32),
      createdAt: now,
      updatedAt: now,
    });
    await db2.collection('profiles').insertOne({
      _id: new mongoose.Types.ObjectId('000000000000000000000726'),
      userId: new mongoose.Types.ObjectId(LEGACY_USER),
      companyInfo: { companyName: 'Legacy Premium Co' },
      socialLinks: [],
      createdAt: now,
      updatedAt: now,
    });
    await db2.collection('catalogproducts').insertOne({
      _id: new mongoose.Types.ObjectId(LEGACY_CATALOG),
      slug: 'premium-card',
      name: 'Premium NFC Card',
      category: 'card',
      kind: 'profile',
      active: true,
      priceMinor: 0,
      sortOrder: 30,
      createdAt: now,
      updatedAt: now,
    });
    const legacyCard = (id: string, alias: string, configured: boolean) => ({
      _id: new mongoose.Types.ObjectId(id),
      cardUid: `LEGACY-${alias}`,
      slug: alias,
      routeSlug: `route-${alias}`,
      urlAlias: alias,
      publicSlug: `legacy/${alias}`,
      name: 'Legacy Premium',
      cardLabel: '',
      kind: 'profile',
      userId: new mongoose.Types.ObjectId(LEGACY_USER),
      assignedUserId: new mongoose.Types.ObjectId(LEGACY_USER),
      status: 'active',
      isActive: true,
      setupComplete: true,
      ...(configured
        ? {
            reviewAssistant: {
              enabled: true,
              googleReviewUrl: 'https://example.test/legacy-premium-google',
              writingStyle: 'friendly',
              preferredLength: 'medium',
              languages: ['English'],
              feedbackTopics: [],
              welcomeMessage: '',
              category: 'cafe',
              employees: [],
              services: [],
              keywords: [],
            },
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
    await db2.collection('cards').insertMany([
      legacyCard(LEGACY_CONFIGURED_CARD, 'legacy-premium-configured', true),
      legacyCard(LEGACY_UNCONFIGURED_CARD, 'legacy-premium-unconfigured', false),
      {
        // Historical bound card that never received a urlAlias. The public
        // review resolver still accepts its printed slug.
        ...legacyCard(LEGACY_SLUG_ONLY_CARD, 'legacy-premium-slug-only', false),
        urlAlias: '',
      },
      // New-workflow canonical Premium assignment with no review settings yet.
      legacyCard(CANONICAL_UNCONFIGURED_CARD, 'canonical-premium-unconfigured', false),
    ]);
    await db2.collection('userproducts').insertMany([
      {
        _id: new mongoose.Types.ObjectId(LEGACY_CONFIGURED_ASSIGN),
        userId: new mongoose.Types.ObjectId(LEGACY_USER),
        catalogProductId: new mongoose.Types.ObjectId(LEGACY_CATALOG),
        cardId: new mongoose.Types.ObjectId(LEGACY_CONFIGURED_CARD),
        standeeId: null,
        quantity: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new mongoose.Types.ObjectId(LEGACY_UNCONFIGURED_ASSIGN),
        userId: new mongoose.Types.ObjectId(LEGACY_USER),
        catalogProductId: new mongoose.Types.ObjectId(LEGACY_CATALOG),
        cardId: new mongoose.Types.ObjectId(LEGACY_UNCONFIGURED_CARD),
        standeeId: null,
        quantity: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new mongoose.Types.ObjectId(LEGACY_SLUG_ONLY_ASSIGN),
        userId: new mongoose.Types.ObjectId(LEGACY_USER),
        catalogProductId: new mongoose.Types.ObjectId('000000000000000000000101'),
        cardId: new mongoose.Types.ObjectId(LEGACY_SLUG_ONLY_CARD),
        standeeId: null,
        quantity: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: new mongoose.Types.ObjectId(CANONICAL_UNCONFIGURED_ASSIGN),
        userId: new mongoose.Types.ObjectId(LEGACY_USER),
        catalogProductId: new mongoose.Types.ObjectId('000000000000000000000101'),
        cardId: new mongoose.Types.ObjectId(CANONICAL_UNCONFIGURED_CARD),
        standeeId: null,
        quantity: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }

  const legacyEntitlement = await resolveEntitlement(LEGACY_USER);
  check(
    'Legacy premium-card slug grants review capability at read time',
    legacyEntitlement.capabilities.has('review_ai_suggestions'),
    `caps=${[...legacyEntitlement.capabilities].filter((c) => c.includes('review')).join(',')}`
  );
  const legacyProducts = await listEligibleReviewProducts(LEGACY_USER);
  const legacyIds = new Set(legacyProducts.map((p) => p.assignmentId));
  check(
    'Legacy Premium cards are eligible with and without Google URL',
    legacyIds.has(LEGACY_CONFIGURED_ASSIGN) && legacyIds.has(LEGACY_UNCONFIGURED_ASSIGN),
    `eligible=${legacyProducts.length}`
  );
  const slugOnly = await getReviewProductForUser(LEGACY_USER, LEGACY_SLUG_ONLY_ASSIGN);
  check(
    'Historical slug-only card resolves an explicit review URL',
    slugOnly.ok && slugOnly.product.eligible && slugOnly.product.previewUrl === '/review/legacy-premium-slug-only',
    slugOnly.ok ? `preview=${slugOnly.product.previewUrl}` : 'not found'
  );
  check(
    'Historical slug-only card keeps its profile destination',
    resolveCardDestination({ kind: 'profile', publicSlug: 'legacy/legacy-premium-slug-only', urlAlias: '' }) === '/legacy/legacy-premium-slug-only',
    ''
  );
  const canonicalUnconfigured = await getReviewProductForUser(LEGACY_USER, CANONICAL_UNCONFIGURED_ASSIGN);
  check(
    'New canonical Premium card is eligible before configuration',
    canonicalUnconfigured.ok &&
      canonicalUnconfigured.product.eligible &&
      canonicalUnconfigured.product.googleDestinationConfigured === false &&
      canonicalUnconfigured.product.previewUrl === '/review/canonical-premium-unconfigured',
    canonicalUnconfigured.ok ? `preview=${canonicalUnconfigured.product.previewUrl}` : 'not found'
  );
  const legacyConfigured = await getReviewProductForUser(LEGACY_USER, LEGACY_CONFIGURED_ASSIGN);
  const legacyUnconfigured = await getReviewProductForUser(LEGACY_USER, LEGACY_UNCONFIGURED_ASSIGN);
  check(
    'Legacy configured/unconfigured review status is accurate',
    legacyConfigured.ok && legacyConfigured.product.googleDestinationConfigured === true &&
      legacyUnconfigured.ok && legacyUnconfigured.product.eligible === true &&
      legacyUnconfigured.product.googleDestinationConfigured === false,
    `configured=${legacyConfigured.ok ? legacyConfigured.product.googleDestinationConfigured : 'missing'} unconfigured=${legacyUnconfigured.ok ? legacyUnconfigured.product.googleDestinationConfigured : 'missing'}`
  );
  check(
    'Legacy Premium review URL is /review/[alias] and profile tap is unchanged',
    legacyConfigured.ok && legacyConfigured.product.previewUrl === '/review/legacy-premium-configured' &&
      resolveCardDestination({ kind: 'profile', publicSlug: 'legacy/legacy-premium-configured', urlAlias: 'legacy-premium-configured' }) === '/legacy/legacy-premium-configured',
    `preview=${legacyConfigured.ok ? legacyConfigured.product.previewUrl : 'none'}`
  );

  const eligible = await listEligibleReviewProducts(OWNER);
  const ids = new Set(eligible.map((p) => p.assignmentId));
  check('Premium is listed as review-eligible', ids.has(PREMIUM_ASSIGN), `ids=${eligible.length}`);
  check('Google Review Card is listed', eligible.some((p) => p.catalogProductSlug === 'google-review-card'), '');
  check('Google Review Plate is listed', eligible.some((p) => p.catalogProductSlug === 'google-review-nfc-plate'), '');
  check('Google Review Standee is listed', eligible.some((p) => p.instanceType === 'standee' && p.catalogProductSlug === 'google-review-standee'), '');
  check('All In One 3 is listed', ids.has(ALL3_ASSIGN), '');
  check('All In One 4 is listed', ids.has(ALL4_ASSIGN), '');
  check('Business NFC Card is not listed', !ids.has(BIZ_ASSIGN), '');

  const premium = await getReviewProductForUser(OWNER, PREMIUM_ASSIGN);
  check(
    'Premium has explicit review preview and configured destination',
    premium.ok && premium.product.eligible && premium.product.previewUrl === '/review/p35-premium' && premium.product.googleDestinationConfigured,
    premium.ok ? `preview=${premium.product.previewUrl} url=${premium.product.effectiveGoogleReviewUrl}` : 'not found'
  );

  const premiumTap = resolveCardDestination({
    kind: 'profile',
    publicSlug: 'p35/premium',
    urlAlias: 'p35-premium',
  });
  check('Premium default NFC destination remains profile', premiumTap === '/p35/premium', `tap=${premiumTap}`);

  const all3 = await resolveStandeeReviewHost('p39-all-in-one-standee-3');
  const all4 = await resolveStandeeReviewHost('p39-all-in-one-standee-4');
  check('All In One 3 review host resolves', Boolean(all3), all3 ? `url=${all3.config.googleReviewUrl}` : 'none');
  check('All In One 4 review host resolves', Boolean(all4), all4 ? `url=${all4.config.googleReviewUrl}` : 'none');
  check(
    'All In One review host uses only the Google slot URL',
    all3?.config.googleReviewUrl === 'https://example.test/all-in-one-standee-3-google' &&
      all4?.config.googleReviewUrl === 'https://example.test/all-in-one-standee-4-google',
    `${all3?.config.googleReviewUrl} | ${all4?.config.googleReviewUrl}`
  );

  const other = await getReviewProductForUser(OTHER, PREMIUM_ASSIGN);
  check('Cross-tenant Premium lookup is denied', !other.ok && (other.reason === 'not_found' || other.reason === 'forbidden'), other.ok ? 'leaked' : other.reason);

  const legacy = resolveReviewSettings({
    card: { reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/premium-google', writingStyle: 'friendly', preferredLength: 'medium', languages: ['English'], feedbackTopics: [], welcomeMessage: '' } },
    source: 'legacy',
  });
  check('Legacy review settings remain readable', legacy.enabled && legacy.googleReviewUrl === 'https://example.test/premium-google', `enabled=${legacy.enabled}`);

  const failures = results.filter((r) => !r.pass);
  console.log('\n=== PHASE 2 REVIEW PRODUCT SUMMARY ===');
  console.log(JSON.stringify({ checks: results.length, passed: results.length - failures.length, failed: failures.length, failures }, null, 2));
  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
