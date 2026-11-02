/**
 * Local-only Central force-all override matrix.
 *
 * Disposable DB only: 127.0.0.1:27019 / taprevia_localcentral_*.
 * Run:
 *   PHASE=force-on     (seeds) CENTRAL...=true  LOCAL_FORCE_ALL=true
 *   PHASE=force-off                CENTRAL...=false LOCAL_FORCE_ALL=false
 *   PHASE=gate-production / gate-vercel / gate-remote
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import { GET as previewGET } from '@/app/api/review-management/preview/route';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import {
  getReviewProductForUser,
  listEligibleReviewProducts,
} from '@/lib/services/review-product-eligibility';
import { connectReviewProduct } from '@/lib/services/review-product-connection';
import { isLocalCentralReviewForceAllEnabled } from '@/lib/services/review-rollout';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { resolveCardDestination } from '@/lib/services/redirect-target';

const PHASE = process.env.PHASE ?? '';
const GATE_PHASES = new Set(['gate-production', 'gate-vercel', 'gate-remote']);
const oid = (suffix: string) => new mongoose.Types.ObjectId(suffix.padStart(24, '0'));
const IDS = {
  owner: oid('c11'),
  newOwner: oid('c12'),
  grcProduct: oid('d11'),
  businessProduct: oid('d12'),
  standeeProduct: oid('d13'),
  legacyCard: oid('e11'),
  hybridCard: oid('e12'),
  ineligibleCard: oid('e13'),
  newCard: oid('e14'),
  standee: oid('e15'),
  legacyAssignment: oid('f11'),
  hybridAssignment: oid('f12'),
  ineligibleAssignment: oid('f13'),
  newAssignment: oid('f14'),
  standeeAssignment: oid('f15'),
};

const now = new Date('2026-01-01T00:00:00.000Z');
const LEGACY_CONFIG = {
  enabled: true,
  googleReviewUrl: 'https://example.test/local-legacy',
  welcomeMessage: 'Legacy local welcome',
  category: 'legacy-cat',
  languages: ['English'],
  writingStyle: 'friendly',
  preferredLength: 'medium',
  feedbackTopics: [],
  employees: [],
  services: [],
  keywords: [],
};

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
  for (const name of ['users', 'cards', 'catalogproducts', 'userproducts', 'reviewsettings', 'reviewcategories', 'reviewtemplates', 'standees', 'profiles']) {
    await db.collection(name).deleteMany({});
  }
  await db.collection('users').insertMany([
    { _id: IDS.owner, name: 'Local Owner', email: 'local-owner@test.invalid', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
    { _id: IDS.newOwner, name: 'New Local Owner', email: 'new-local-owner@test.invalid', role: 'customer', status: 'active', passwordHash: 'x'.repeat(32), createdAt: now, updatedAt: now },
  ]);
  await db.collection('profiles').insertMany([
    { _id: oid('a11'), userId: IDS.owner, companyInfo: { companyName: 'Local Owner Co' }, socialLinks: [], createdAt: now, updatedAt: now },
    { _id: oid('a12'), userId: IDS.newOwner, companyInfo: { companyName: 'New Local Owner Co' }, socialLinks: [], createdAt: now, updatedAt: now },
  ]);
  await db.collection('catalogproducts').insertMany([
    { _id: IDS.grcProduct, slug: 'google-review-card', name: 'Google Review Card', category: 'card', kind: 'review', active: true, createdAt: now, updatedAt: now },
    { _id: IDS.businessProduct, slug: 'business-nfc-card', name: 'Business NFC Card', category: 'card', kind: 'profile', active: true, createdAt: now, updatedAt: now },
    { _id: IDS.standeeProduct, slug: 'google-review-standee', name: 'Google Review Standee', category: 'standee', kind: 'standee', active: true, createdAt: now, updatedAt: now },
  ]);
  const card = (id: mongoose.Types.ObjectId, alias: string, extra: Record<string, unknown>) => ({
    _id: id, cardUid: `LOCAL-${alias.toUpperCase()}`, slug: alias, urlAlias: alias,
    publicSlug: `local/${alias}`, name: alias, kind: 'review', userId: IDS.owner,
    assignedUserId: IDS.owner, status: 'active', isActive: true, setupComplete: true,
    createdAt: now, updatedAt: now, ...extra,
  });
  await db.collection('cards').insertMany([
    card(IDS.legacyCard, 'local-legacy', { reviewAssistant: LEGACY_CONFIG }),
    card(IDS.hybridCard, 'local-hybrid', {
      reviewSettingsSource: 'hybrid',
      reviewAssistant: { enabled: false, googleReviewUrl: '' },
      reviewOverrides: { welcomeMessage: 'Hybrid local override', googleReviewUrl: 'https://example.test/local-hybrid' },
      reviewSettingsVersion: 0,
    }),
    card(IDS.ineligibleCard, 'local-ineligible', {
      kind: 'profile',
      reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/local-ineligible' },
    }),
  ]);
  await db.collection('standees').insertOne({
    _id: IDS.standee, userId: IDS.owner, name: 'Local Standee', displayName: 'Local Standee',
    routeSlug: 'local-standee', uid: 'local-standee', productKey: 'GOOGLE_REVIEW_STANDEE',
    maxProfiles: 1, fixedProfiles: ['google_review'],
    panelQr: { qrId: 'panel-local', qrColor: '#000000' },
    socialQrs: [{ qrId: 'google-local', platform: 'google_review', label: 'Google Review', qrColor: '#000000', destinationUrl: 'https://example.test/local-standee-google' }],
    createdAt: now, updatedAt: now,
  });
  const assignment = (id: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId, product: mongoose.Types.ObjectId, extra: Record<string, unknown>) => ({
    _id: id, userId, catalogProductId: product, cardId: null, standeeId: null, quantity: 1,
    status: 'active', createdAt: now, updatedAt: now, ...extra,
  });
  await db.collection('userproducts').insertMany([
    assignment(IDS.legacyAssignment, IDS.owner, IDS.grcProduct, { cardId: IDS.legacyCard }),
    assignment(IDS.hybridAssignment, IDS.owner, IDS.grcProduct, { cardId: IDS.hybridCard }),
    assignment(IDS.ineligibleAssignment, IDS.owner, IDS.businessProduct, { cardId: IDS.ineligibleCard }),
    assignment(IDS.standeeAssignment, IDS.owner, IDS.standeeProduct, { standeeId: IDS.standee }),
  ]);
  for (const businessId of [IDS.owner, IDS.newOwner]) {
    await db.collection('reviewsettings').insertOne({
      businessId, schemaVersion: 1,
      general: { enabled: true, googleReviewUrl: 'https://example.test/local-central', welcomeMessage: 'Local Central welcome', businessName: 'Local Central Business' },
      content: { category: 'local-central-cat', languages: ['English'], writingStyle: 'professional', preferredLength: 'medium', styleMode: 'fixed', lengthMode: 'fixed', feedbackTopics: [], services: [], employees: [], keywords: [] },
      updatedBy: businessId, createdAt: now, updatedAt: now, __v: 0,
    });
  }
  await db.collection('reviewcategories').insertMany([
    { _id: oid('a21'), key: 'local-central-cat', name: 'Local Central', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
    { _id: oid('a22'), key: 'legacy-cat', name: 'Legacy', active: true, languages: ['English'], scenarios: [{ key: 'service', name: 'Service' }], createdAt: now, updatedAt: now },
  ]);
  await db.collection('reviewtemplates').insertMany([
    { _id: oid('b11'), key: 'local-central-tpl', categoryKey: 'local-central-cat', scenario: 'service', language: 'English', text: 'Central local review for {businessName}.', length: 'medium', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
    { _id: oid('b12'), key: 'local-legacy-tpl', categoryKey: 'legacy-cat', scenario: 'service', language: 'English', text: 'Legacy local review for {businessName}.', length: 'medium', style: 'friendly', variables: ['businessName'], compatibleKeywords: [], active: true, usageCount: 0, lastShownAt: null, createdAt: now, updatedAt: now },
  ]);
}

async function resolved(cardId: mongoose.Types.ObjectId) {
  const card = await Card.findById(cardId).lean();
  assert.ok(card);
  return resolveEffectiveReviewSettings(card as never);
}

async function addNewAssignment() {
  const db = mongoose.connection.db!;
  await db.collection('cards').insertOne({
    _id: IDS.newCard, cardUid: 'LOCAL-NEW-CARD', slug: 'local-new-card', urlAlias: 'local-new-card',
    publicSlug: 'local/new-card', name: 'New Local Card', kind: 'review', userId: IDS.newOwner,
    assignedUserId: IDS.newOwner, status: 'active', isActive: true, setupComplete: true,
    reviewAssistant: { ...LEGACY_CONFIG, googleReviewUrl: 'https://example.test/local-new-legacy' },
    createdAt: now, updatedAt: now,
  });
  await db.collection('userproducts').insertOne({
    _id: IDS.newAssignment, userId: IDS.newOwner, catalogProductId: IDS.grcProduct,
    cardId: IDS.newCard, standeeId: null, quantity: 1, status: 'active', createdAt: now, updatedAt: now,
  });
}

async function main() {
  if (!GATE_PHASES.has(PHASE)) {
    const URI = process.env.MONGODB_URI ?? '';
    const DB = process.env.MONGODB_DB ?? '';
    if (!URI.includes('127.0.0.1:27019') || !DB.startsWith('taprevia_localcentral_')) {
      throw new Error(`Refusing non-isolated target: ${URI || '(unset)'} / ${DB || '(unset)'}`);
    }
  }

  if (GATE_PHASES.has(PHASE)) {
    check(`local force-all disabled for ${PHASE}`, isLocalCentralReviewForceAllEnabled() === false);
    console.log(JSON.stringify({ checks: passed + failed, passed, failed, failures }, null, 2));
    process.exit(failed === 0 ? 0 : 1);
  }

  await connectDB();
  if (PHASE === 'force-on') {
    await seed();
    await addNewAssignment();
  }

  const token = jwt.sign(
    { userId: String(IDS.owner), role: 'customer' },
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
    return { status: response.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };

  if (PHASE === 'force-on') {
    check('local force-all override active', isLocalCentralReviewForceAllEnabled());

    const legacy = await resolved(IDS.legacyCard);
    check('existing legacy product uses central', legacy.source === 'central' && legacy.googleReviewUrl === 'https://example.test/local-central', `${legacy.source}/${legacy.googleReviewUrl}`);
    const centralSuggestions = await getReviewTemplateSuggestions({
      card: { name: 'Local Owner Co', reviewAssistant: legacy },
      language: 'English',
    });
    check('central Review Library templates available', centralSuggestions.some((s) => s.text.includes('Central local review')), `${centralSuggestions.length} suggestion(s)`);

    const hybrid = await resolved(IDS.hybridCard);
    check('hybrid destination override preserved', hybrid.source === 'hybrid' && hybrid.googleReviewUrl === 'https://example.test/local-hybrid' && hybrid.welcomeMessage === 'Hybrid local override', `${hybrid.source}/${hybrid.googleReviewUrl}`);

    const ownerProducts = await listEligibleReviewProducts(String(IDS.owner));
    const legacyProduct = ownerProducts.find((p) => p.cardId === String(IDS.legacyCard));
    check('existing eligible product projected as central', legacyProduct?.settingsSource === 'central', legacyProduct?.settingsSource);
    check('ineligible product excluded', ownerProducts.every((p) => p.cardId !== String(IDS.ineligibleCard)));

    const newProducts = await listEligibleReviewProducts(String(IDS.newOwner));
    check('newly assigned eligible product uses central', newProducts.length === 1 && newProducts[0].settingsSource === 'central', newProducts[0]?.settingsSource);
    const newResolved = await resolved(IDS.newCard);
    check('newly created user resolves central', newResolved.source === 'central' && newResolved.googleReviewUrl === 'https://example.test/local-central', newResolved.source);

    const previewLegacy = await preview(IDS.legacyAssignment);
    check('preview uses central settings', previewLegacy.status === 200 && previewLegacy.json?.source === 'central' && previewLegacy.json?.settings?.googleReviewUrl === 'https://example.test/local-central', `status=${previewLegacy.status} source=${previewLegacy.json?.source}`);

    const beforeSwitch = await Card.findById(IDS.legacyCard).lean<any>();
    const blocked = await connectReviewProduct({
      userId: String(IDS.owner),
      assignmentId: String(IDS.legacyAssignment),
      input: { source: 'legacy', revision: beforeSwitch?.reviewSettingsVersion ?? 0 },
    });
    const afterSwitch = await Card.findById(IDS.legacyCard).lean<any>();
    check('product-specific mode blocked locally', !blocked.ok && blocked.status === 400, blocked.ok ? 'unexpected success' : blocked.message);
    check('blocked switch preserves source/settings', afterSwitch?.reviewSettingsSource === beforeSwitch?.reviewSettingsSource && JSON.stringify(afterSwitch?.reviewAssistant) === JSON.stringify(beforeSwitch?.reviewAssistant));

    const ineligible = await getReviewProductForUser(String(IDS.owner), String(IDS.ineligibleAssignment));
    check('ineligible entitlement restriction preserved', !ineligible.ok, ineligible.ok ? 'unexpected eligible' : ineligible.reason);

    const standeeHost = await resolveStandeeReviewHost('local-standee');
    check('standee uses central content but keeps its destination', Boolean(standeeHost) && standeeHost?.config.category === 'local-central-cat' && standeeHost?.config.googleReviewUrl === 'https://example.test/local-standee-google', standeeHost?.config.category);
    check('NFC review destination unchanged', resolveCardDestination({ kind: 'review', urlAlias: 'local-legacy' }) === '/review/local-legacy');
  }

  if (PHASE === 'force-off') {
    check('local force-all override disabled', !isLocalCentralReviewForceAllEnabled());
    const legacy = await resolved(IDS.legacyCard);
    check('existing legacy product restored', legacy.source === 'legacy' && legacy.googleReviewUrl.includes('local-legacy'), `${legacy.source}/${legacy.googleReviewUrl}`);
    const ownerProducts = await listEligibleReviewProducts(String(IDS.owner));
    const legacyProduct = ownerProducts.find((p) => p.cardId === String(IDS.legacyCard));
    check('product projection restored to legacy', legacyProduct?.settingsSource === 'legacy', legacyProduct?.settingsSource);
    const newProducts = await listEligibleReviewProducts(String(IDS.newOwner));
    check('newly assigned product restored to legacy', newProducts.length === 1 && newProducts[0].settingsSource === 'legacy', newProducts[0]?.settingsSource);

    const card = await Card.findById(IDS.legacyCard).lean<any>();
    const switched = await connectReviewProduct({
      userId: String(IDS.owner),
      assignmentId: String(IDS.legacyAssignment),
      input: { source: 'legacy', revision: card?.reviewSettingsVersion ?? 0 },
    });
    check('product-specific workflow re-enabled', switched.ok, switched.ok ? 'ok' : switched.message);
    check('legacy data preserved across override off', JSON.stringify(card?.reviewAssistant) === JSON.stringify(LEGACY_CONFIG) && card?.urlAlias === 'local-legacy' && card?.slug === 'local-legacy');
  }

  console.log(`\n=== LOCAL CENTRAL ${PHASE.toUpperCase()} ===`);
  console.log(JSON.stringify({ checks: passed + failed, passed, failed, failures }, null, 2));
  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
