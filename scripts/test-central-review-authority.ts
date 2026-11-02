/**
 * Central vs product-specific review authority matrix.
 *
 * Disposable DB only: 127.0.0.1:27019 / taprevia_centralreview_*.
 *
 * Run three phases against the SAME isolated database:
 *   PHASE=off-baseline (seeds) with CENTRAL...=false
 *   PHASE=on           with CENTRAL...=true + tenant allowlist
 *   PHASE=off-final    with CENTRAL...=false
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { connectDB } from '@/lib/db';
import { GET as previewGET } from '@/app/api/review-management/preview/route';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import {
  listEligibleReviewProducts,
  getReviewProductForUser,
} from '@/lib/services/review-product-eligibility';
import { connectReviewProduct } from '@/lib/services/review-product-connection';
import { isCentralPublicIntegrationEnabledForTenant } from '@/lib/services/review-rollout';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';

const URI = process.env.MONGODB_URI ?? '';
const DB = process.env.MONGODB_DB ?? '';
const PHASE = process.env.PHASE ?? '';
if (!URI.includes('127.0.0.1:27019') || !DB.startsWith('taprevia_centralreview_')) {
  throw new Error(`Refusing non-isolated target: ${URI || '(unset)'} / ${DB || '(unset)'}`);
}
if (!['off-baseline', 'on', 'off-final'].includes(PHASE)) {
  throw new Error(`PHASE must be off-baseline, on or off-final (got "${PHASE}")`);
}

const oid = (suffix: string) => new mongoose.Types.ObjectId(suffix.padStart(24, '0'));
const IDS = {
  ownerAllowed: oid('c01'),
  ownerNotAllowed: oid('c02'),
  grcProduct: oid('d01'),
  businessProduct: oid('d02'),
  legacyCard: oid('e01'),
  centralCard: oid('e02'),
  hybridCard: oid('e03'),
  switchCard: oid('e04'),
  ineligibleCard: oid('e05'),
  notAllowedCard: oid('e06'),
  legacyAssignment: oid('f01'),
  centralAssignment: oid('f02'),
  hybridAssignment: oid('f03'),
  switchAssignment: oid('f04'),
  ineligibleAssignment: oid('f05'),
  notAllowedAssignment: oid('f06'),
};

const now = new Date('2026-01-01T00:00:00.000Z');
const LEGACY_CONFIG = {
  enabled: true,
  googleReviewUrl: 'https://example.test/legacy-review',
  welcomeMessage: 'Legacy welcome',
  category: 'legacy-cat',
  languages: ['English'],
  writingStyle: 'friendly',
  preferredLength: 'medium',
  feedbackTopics: [],
  employees: [],
  services: [],
  keywords: [],
};
const SWITCH_CONFIG = { ...LEGACY_CONFIG, googleReviewUrl: 'https://example.test/switch-review' };

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function seed() {
  const db = mongoose.connection.db!;
  for (const name of ['users', 'cards', 'catalogproducts', 'userproducts', 'reviewsettings', 'reviewcategories', 'reviewtemplates']) {
    await db.collection(name).deleteMany({});
  }
  await db.collection('users').insertMany([
    { _id: IDS.ownerAllowed, name: 'Allowed Owner', email: 'allowed@central.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: IDS.ownerNotAllowed, name: 'Not Allowed Owner', email: 'notallowed@central.test', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertMany([
    { _id: IDS.grcProduct, slug: 'google-review-card', name: 'Google Review Card', category: 'card', kind: 'review', active: true, priceMinor: 149900, currency: 'INR', createdAt: now, updatedAt: now },
    { _id: IDS.businessProduct, slug: 'business-nfc-card', name: 'Business NFC Card', category: 'card', kind: 'profile', active: true, priceMinor: 99900, currency: 'INR', createdAt: now, updatedAt: now },
  ]);
  const card = (id: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId, alias: string, extra: Record<string, unknown>) => ({
    _id: id,
    cardUid: `CENTRAL-${alias.toUpperCase()}`,
    slug: alias,
    urlAlias: alias,
    publicSlug: `allowed/${alias}`,
    name: alias,
    kind: 'review',
    userId,
    assignedUserId: userId,
    status: 'active',
    isActive: true,
    setupComplete: true,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
  await db.collection('cards').insertMany([
    card(IDS.legacyCard, IDS.ownerAllowed, 'legacy-card', { reviewAssistant: LEGACY_CONFIG }),
    card(IDS.centralCard, IDS.ownerAllowed, 'central-card', {
      reviewAssistant: { enabled: false, googleReviewUrl: '' },
      reviewSettingsSource: 'central',
      reviewSettingsVersion: 0,
    }),
    card(IDS.hybridCard, IDS.ownerAllowed, 'hybrid-card', {
      reviewAssistant: { enabled: false, googleReviewUrl: '' },
      reviewSettingsSource: 'hybrid',
      reviewOverrides: { welcomeMessage: 'Hybrid override', googleReviewUrl: 'https://example.test/hybrid-review' },
      reviewSettingsVersion: 0,
    }),
    card(IDS.switchCard, IDS.ownerAllowed, 'switch-card', {
      reviewAssistant: SWITCH_CONFIG,
      reviewSettingsVersion: 0,
    }),
    card(IDS.ineligibleCard, IDS.ownerAllowed, 'ineligible-card', {
      kind: 'profile',
      reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/ineligible' },
    }),
    card(IDS.notAllowedCard, IDS.ownerNotAllowed, 'not-allowed-card', {
      reviewAssistant: { ...LEGACY_CONFIG, googleReviewUrl: 'https://example.test/not-allowed' },
    }),
  ]);
  const assignment = (
    id: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    product: mongoose.Types.ObjectId,
    cardId: mongoose.Types.ObjectId
  ) => ({ _id: id, userId, catalogProductId: product, cardId, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now });
  await db.collection('userproducts').insertMany([
    assignment(IDS.legacyAssignment, IDS.ownerAllowed, IDS.grcProduct, IDS.legacyCard),
    assignment(IDS.centralAssignment, IDS.ownerAllowed, IDS.grcProduct, IDS.centralCard),
    assignment(IDS.hybridAssignment, IDS.ownerAllowed, IDS.grcProduct, IDS.hybridCard),
    assignment(IDS.switchAssignment, IDS.ownerAllowed, IDS.grcProduct, IDS.switchCard),
    assignment(IDS.ineligibleAssignment, IDS.ownerAllowed, IDS.businessProduct, IDS.ineligibleCard),
    assignment(IDS.notAllowedAssignment, IDS.ownerNotAllowed, IDS.grcProduct, IDS.notAllowedCard),
  ]);
  await db.collection('reviewsettings').insertOne({
    businessId: IDS.ownerAllowed,
    schemaVersion: 1,
    general: {
      enabled: true,
      googleReviewUrl: 'https://example.test/central-review',
      welcomeMessage: 'Central welcome',
      businessName: 'Central Business',
    },
    content: {
      category: 'central-cat',
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
    updatedBy: IDS.ownerAllowed,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  });
  await db.collection('reviewcategories').insertMany([
    { _id: oid('a01'), key: 'central-cat', name: 'Central Category', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
    { _id: oid('a02'), key: 'legacy-cat', name: 'Legacy Category', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
  ]);
  const template = (id: string, key: string, categoryKey: string, text: string) => ({
    _id: oid(id), key, categoryKey, scenario: 'service', language: 'English', text,
    length: 'medium', style: 'friendly', variables: ['businessName'], compatibleKeywords: [],
    active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now,
  });
  await db.collection('reviewtemplates').insertMany([
    template('b01', 'central-tpl', 'central-cat', 'Central review for {businessName}.'),
    template('b02', 'legacy-tpl', 'legacy-cat', 'Legacy review for {businessName}.'),
  ]);
}

async function resolved(cardId: mongoose.Types.ObjectId) {
  const card = await Card.findById(cardId).lean();
  assert.ok(card);
  return resolveEffectiveReviewSettings(card as never);
}

async function suggestionsFor(config: Awaited<ReturnType<typeof resolved>>) {
  return getReviewTemplateSuggestions({
    card: { name: 'Owner Business', reviewAssistant: config },
    language: 'English',
  });
}

async function main() {
  await connectDB();
  if (PHASE === 'off-baseline') await seed();

  const token = jwt.sign(
    { userId: String(IDS.ownerAllowed), role: 'customer' },
    process.env.JWT_SECRET as string,
    { expiresIn: '1h' }
  );
  const preview = async (assignmentId: mongoose.Types.ObjectId) => {
    const request = new NextRequest(
      `http://localhost/api/review-management/preview?assignmentId=${String(assignmentId)}`,
      { headers: { cookie: `token=${token}` } }
    );
    const response = await previewGET(request);
    const text = await response.text();
    return {
      status: response.status,
      json: text ? (JSON.parse(text) as Record<string, any>) : null,
    };
  };

  const allowedCentral = isCentralPublicIntegrationEnabledForTenant(String(IDS.ownerAllowed));
  const notAllowedCentral = isCentralPublicIntegrationEnabledForTenant(String(IDS.ownerNotAllowed));

  if (PHASE === 'off-baseline') {
    check('Central OFF: rollout disabled', !allowedCentral && !notAllowedCentral);
    const legacy = await resolved(IDS.legacyCard);
    check('Central OFF: legacy source remains legacy', legacy.source === 'legacy', legacy.source);
    check('Central OFF: legacy URL preserved', legacy.googleReviewUrl.includes('legacy-review'), legacy.googleReviewUrl);
    const legacySuggestions = await suggestionsFor(legacy);
    check('Central OFF: Engine A uses legacy category', legacySuggestions.some((s) => s.text.includes('Legacy review')), `${legacySuggestions.length} suggestion(s)`);
    const legacyPreview = await preview(IDS.legacyAssignment);
    check(
      'Central OFF: preview shows legacy settings',
      legacyPreview.status === 200 &&
        legacyPreview.json?.source === 'legacy' &&
        String(legacyPreview.json?.settings?.googleReviewUrl ?? '').includes('legacy-review'),
      `status=${legacyPreview.status} source=${legacyPreview.json?.source}`
    );

    const central = await resolved(IDS.centralCard);
    check('Central OFF: central source falls back to legacy', central.source === 'legacy', central.source);
    const hybrid = await resolved(IDS.hybridCard);
    check('Central OFF: hybrid source falls back to legacy', hybrid.source === 'legacy', hybrid.source);

    const products = await listEligibleReviewProducts(String(IDS.ownerAllowed));
    const legacyProduct = products.find((p) => p.cardId === String(IDS.legacyCard));
    check('Central OFF: product list keeps stored legacy source', legacyProduct?.settingsSource === 'legacy', legacyProduct?.settingsSource);
    check('Central OFF: ineligible product excluded', products.every((p) => p.cardId !== String(IDS.ineligibleCard)));

    const switchCard = await Card.findById(IDS.switchCard).lean<any>();
    const switched = await connectReviewProduct({
      userId: String(IDS.ownerAllowed),
      assignmentId: String(IDS.switchAssignment),
      input: { source: 'legacy', revision: switchCard?.reviewSettingsVersion ?? 0 },
    });
    check('Central OFF: legacy product workflow remains available', switched.ok, switched.ok ? 'ok' : switched.message);
  }

  if (PHASE === 'on') {
    check('Central ON: allowlisted tenant effective', allowedCentral);
    check('Central ON: non-allowlisted tenant unaffected', !notAllowedCentral);

    const legacy = await resolved(IDS.legacyCard);
    check('Central ON: unconnected legacy product remains legacy', legacy.source === 'legacy', legacy.source);
    check('Central ON: unconnected legacy URL unchanged', legacy.googleReviewUrl.includes('legacy-review'), legacy.googleReviewUrl);
    const legacySuggestions = await suggestionsFor(legacy);
    check('Central ON: unconnected legacy Engine A unchanged', legacySuggestions.some((s) => s.text.includes('Legacy review')), `${legacySuggestions.length} suggestion(s)`);
    const legacyPreview = await preview(IDS.legacyAssignment);
    check(
      'Central ON: unconnected legacy preview unchanged',
      legacyPreview.status === 200 &&
        legacyPreview.json?.source === 'legacy' &&
        String(legacyPreview.json?.settings?.googleReviewUrl ?? '').includes('legacy-review'),
      `status=${legacyPreview.status} source=${legacyPreview.json?.source}`
    );

    const central = await resolved(IDS.centralCard);
    check('Central ON: connected central product uses central', central.source === 'central' && central.googleReviewUrl === 'https://example.test/central-review', `${central.source}/${central.googleReviewUrl}`);
    const centralSuggestions = await suggestionsFor(central);
    check('Central ON: connected product uses central category only', centralSuggestions.some((s) => s.text.includes('Central review')) && !centralSuggestions.some((s) => s.text.includes('Legacy review')), `${centralSuggestions.length} suggestion(s)`);
    const centralPreview = await preview(IDS.centralAssignment);
    check(
      'Central ON: connected product preview shows central settings',
      centralPreview.status === 200 &&
        centralPreview.json?.source === 'central' &&
        centralPreview.json?.settings?.googleReviewUrl === 'https://example.test/central-review',
      `status=${centralPreview.status} source=${centralPreview.json?.source}`
    );

    const hybrid = await resolved(IDS.hybridCard);
    check('Central ON: hybrid overrides preserved', hybrid.source === 'hybrid' && hybrid.welcomeMessage === 'Hybrid override', `${hybrid.source}/${hybrid.welcomeMessage}`);
    const notAllowed = await resolved(IDS.notAllowedCard);
    check('Central ON: non-allowlisted tenant stays legacy', notAllowed.source === 'legacy', notAllowed.source);

    const products = await listEligibleReviewProducts(String(IDS.ownerAllowed));
    const legacyProduct = products.find((p) => p.cardId === String(IDS.legacyCard));
    const centralProduct = products.find((p) => p.cardId === String(IDS.centralCard));
    check('Central ON: unconnected product list source unchanged', legacyProduct?.settingsSource === 'legacy', legacyProduct?.settingsSource);
    check('Central ON: connected product list source is central', centralProduct?.settingsSource === 'central', centralProduct?.settingsSource);
    check('Central ON: ineligible product remains excluded', products.every((p) => p.cardId !== String(IDS.ineligibleCard)));

    const legacyLookup = await getReviewProductForUser(String(IDS.ownerAllowed), String(IDS.legacyAssignment));
    const centralLookup = await getReviewProductForUser(String(IDS.ownerAllowed), String(IDS.centralAssignment));
    check('Central ON: unconnected product settings unchanged', legacyLookup.ok && legacyLookup.product.settingsSource === 'legacy', legacyLookup.ok ? legacyLookup.product.settingsSource : legacyLookup.reason);
    check('Central ON: connected product settings use central', centralLookup.ok && centralLookup.product.settingsSource === 'central' && centralLookup.product.reviewAssistantEnabled, centralLookup.ok ? centralLookup.product.settingsSource : centralLookup.reason);

    const switchBefore = await Card.findById(IDS.centralCard).lean<any>();
    const blocked = await connectReviewProduct({
      userId: String(IDS.ownerAllowed),
      assignmentId: String(IDS.centralAssignment),
      input: { source: 'legacy', revision: switchBefore?.reviewSettingsVersion ?? 0 },
    });
    const switchAfter = await Card.findById(IDS.centralCard).lean<any>();
    check('Central ON: connected product cannot switch back to legacy', !blocked.ok && blocked.status === 400, blocked.ok ? 'unexpected success' : blocked.message);
    check(
      'Central ON: blocked switch does not rewrite stored source/settings',
      switchAfter?.reviewSettingsSource === switchBefore?.reviewSettingsSource &&
        switchAfter?.reviewSettingsVersion === switchBefore?.reviewSettingsVersion &&
        JSON.stringify(switchAfter?.reviewAssistant) === JSON.stringify(switchBefore?.reviewAssistant)
    );

    const legacyAfterOn = await Card.findById(IDS.legacyCard).lean<any>();
    check(
      'Central ON: legacy data preserved, source not migrated',
      legacyAfterOn?.reviewSettingsSource !== 'central' &&
        JSON.stringify(legacyAfterOn?.reviewAssistant) === JSON.stringify(LEGACY_CONFIG) &&
        legacyAfterOn?.urlAlias === 'legacy-card' &&
        legacyAfterOn?.slug === 'legacy-card'
    );
  }

  if (PHASE === 'off-final') {
    check('Central ON → OFF: rollout disabled again', !allowedCentral && !notAllowedCentral);
    const legacy = await resolved(IDS.legacyCard);
    check('Central ON → OFF: legacy behavior restored', legacy.source === 'legacy' && legacy.googleReviewUrl.includes('legacy-review'), `${legacy.source}/${legacy.googleReviewUrl}`);
    const legacySuggestions = await suggestionsFor(legacy);
    check('Central ON → OFF: Engine A restored to legacy category', legacySuggestions.some((s) => s.text.includes('Legacy review')) && !legacySuggestions.some((s) => s.text.includes('Central review')), `${legacySuggestions.length} suggestion(s)`);
    const legacyPreview = await preview(IDS.legacyAssignment);
    check(
      'Central ON → OFF: preview restores legacy settings',
      legacyPreview.status === 200 &&
        legacyPreview.json?.source === 'legacy' &&
        String(legacyPreview.json?.settings?.googleReviewUrl ?? '').includes('legacy-review'),
      `status=${legacyPreview.status} source=${legacyPreview.json?.source}`
    );

    const central = await resolved(IDS.centralCard);
    check('Central ON → OFF: stored central product falls back to legacy', central.source === 'legacy', central.source);
    const hybrid = await resolved(IDS.hybridCard);
    check('Central ON → OFF: stored hybrid product falls back to legacy', hybrid.source === 'legacy', hybrid.source);

    const legacyCard = await Card.findById(IDS.legacyCard).lean<any>();
    check(
      'Central ON → OFF: legacy settings and URLs preserved',
      JSON.stringify(legacyCard?.reviewAssistant) === JSON.stringify(LEGACY_CONFIG) &&
        legacyCard?.urlAlias === 'legacy-card' &&
        legacyCard?.slug === 'legacy-card'
    );

    const switchCard = await Card.findById(IDS.centralCard).lean<any>();
    const switched = await connectReviewProduct({
      userId: String(IDS.ownerAllowed),
      assignmentId: String(IDS.centralAssignment),
      input: { source: 'legacy', revision: switchCard?.reviewSettingsVersion ?? 0 },
    });
    check('Central ON → OFF: legacy product workflow re-enabled', switched.ok, switched.ok ? 'ok' : switched.message);
  }

  console.log(`\n=== CENTRAL REVIEW ${PHASE.toUpperCase()} ===`);
  console.log(JSON.stringify({ checks: passed + failed, passed, failed, failures }, null, 2));
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
