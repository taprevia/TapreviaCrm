/**
 * Phase 4 URL concurrency + existing route compatibility.
 *
 * Isolated only: localhost Mongo, MONGODB_DB starting `taprevia_phase4_`.
 * Drops only that disposable database.
 */
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User from '@/models/User';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import CatalogProduct from '@/models/CatalogProduct';
import UserProduct from '@/models/UserProduct';
import Profile from '@/models/Profile';
import ReviewSettings from '@/models/ReviewSettings';
import { connectDB } from '@/lib/db';
import {
  ensureCardPublicSlug,
  ensureStandeePublicSlug,
  getPublicCardByPublicSlug,
  getPublicStandeeByPublicSlug,
  getPublicProductSlug,
  STANDEES_PUBLIC_PRODUCT_SEGMENT,
  STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT,
} from '@/lib/services/human-url';
import { getPublicCardByAlias, resolvePublicCardProfile } from '@/lib/services/card-access';
import { resolveStandeePanel } from '@/lib/services/standee-panel';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { GET as routeResolverGET } from '@/app/r/[...slug]/route';

const URI = process.env.MONGODB_URI ?? '';
const DB = process.env.MONGODB_DB ?? '';
if (!URI.includes('127.0.0.1') || !DB.startsWith('taprevia_phase4_')) {
  throw new Error(`Refusing non-isolated target: ${URI} / ${DB}`);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

async function route(path: string) {
  const request = new NextRequest(`http://localhost${path}`);
  const response = await routeResolverGET(request, {
    params: { slug: path.split('/').filter(Boolean).slice(1) },
  });
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    text: await response.text(),
  };
}

async function main() {
  await connectDB();
  await mongoose.connection.dropDatabase();
  // Dropping the disposable database also drops its indexes. Recreate the
  // unique URL indexes so the isolated test matches the real schema.
  await Card.createIndexes();
  await Standee.createIndexes();

  const user = await User.create({
    name: 'Phase4 URL Owner',
    email: 'phase4-url-owner@local.invalid',
    passwordHash: 'phase4-pass-123',
    role: 'customer',
    status: 'active',
    bizSlug: 'phase4-url-owner',
  });
  await Profile.create({
    userId: user._id,
    companyInfo: { companyName: 'Phase4 URL Owner' },
    personalInfo: { fullName: 'Phase4 URL Owner' },
  });

  const businessProduct = await CatalogProduct.create({
    name: 'Business NFC Card',
    slug: 'business-nfc-card',
    category: 'card',
    kind: 'profile',
    active: true,
    priceMinor: 0,
  });
  const reviewProduct = await CatalogProduct.create({
    name: 'Google Review Card',
    slug: 'google-review-card',
    category: 'card',
    kind: 'review',
    active: true,
    priceMinor: 0,
  });
  const reviewStandeeProduct = await CatalogProduct.create({
    name: 'Google Review Standee',
    slug: 'google-review-standee',
    category: 'standee',
    kind: 'standee',
    active: true,
    priceMinor: 0,
  });

  const makeCard = async (index: number) => {
    const card = await Card.create({
      cardUid: `PHASE4-CONCARD-${index}`,
      slug: `phase4-concard-${index}`,
      userId: user._id,
      assignedUserId: user._id,
      status: 'active',
      isActive: true,
      kind: 'profile',
      routeSlug: `phase4-concard-route-${index}`,
      uid: `phase4-concard-route-${index}`,
    });
    await UserProduct.create({
      userId: user._id,
      catalogProductId: businessProduct._id,
      cardId: card._id,
      quantity: 1,
      status: 'active',
    });
    return card;
  };

  // ── B1: same-collection concurrent card allocation ──────────────────────
  const cards = await Promise.all(Array.from({ length: 12 }, (_, i) => makeCard(i + 1)));
  const cardAllocations = await Promise.all(
    cards.map((card) => ensureCardPublicSlug(card._id, user._id))
  );
  const cardSlugs = cardAllocations.map((a) => a.publicSlug ?? '');
  check(
    'B1 all card allocations assigned',
    cardAllocations.every((a) => a.assigned && a.publicSlug),
    JSON.stringify(cardAllocations.map((a) => a.assigned))
  );
  check('B1 card slugs unique', new Set(cardSlugs).size === cardSlugs.length, `${new Set(cardSlugs).size}/${cardSlugs.length}`);
  const persistedCards = await Card.find({ _id: { $in: cards.map((c) => c._id) } })
    .select('publicSlug')
    .lean<any[]>();
  const persistedCardSet = new Set(persistedCards.map((c) => c.publicSlug));
  check(
    'B1 returned card slugs match persisted values',
    cardSlugs.every((slug) => persistedCardSet.has(slug)),
    JSON.stringify([...persistedCardSet])
  );

  // ── B2: idempotency ─────────────────────────────────────────────────────
  const again = await Promise.all(cards.map((card) => ensureCardPublicSlug(card._id, user._id)));
  check(
    'B2 repeated card allocation is idempotent',
    again.every((a) => a.assigned && a.publicSlug) &&
      again.map((a) => a.publicSlug).sort().join('|') === [...cardSlugs].sort().join('|'),
    'second pass'
  );

  // ── B3: standee allocation + cross-collection distinctness ──────────────
  const makeStandee = async (index: number) => {
    const standee = await Standee.create({
      userId: user._id,
      name: `Phase4 Standee ${index}`,
      displayName: `Phase4 Standee ${index}`,
      routeSlug: `phase4-standee-route-${index}`,
      uid: `phase4-standee-route-${index}`,
      productKey: 'GOOGLE_REVIEW_STANDEE',
      maxProfiles: 1,
      fixedProfiles: ['google_review'],
      panelQr: { qrId: `phase4-panel-${index}`, qrColor: '#000000' },
      socialQrs: [
        {
          qrId: `phase4-slot-${index}`,
          platform: 'google_review',
          label: 'Google Review',
          qrColor: '#000000',
          destinationUrl: `https://example.test/phase4-standee-${index}`,
        },
      ],
    });
    await UserProduct.create({
      userId: user._id,
      catalogProductId: reviewStandeeProduct._id,
      standeeId: standee._id,
      quantity: 1,
      status: 'active',
    });
    return standee;
  };
  const standees = await Promise.all(Array.from({ length: 8 }, (_, i) => makeStandee(i + 1)));
  const standeeAllocations = await Promise.all(
    standees.map((standee) => ensureStandeePublicSlug(standee._id, user._id))
  );
  const standeeSlugs = standeeAllocations.map((a) => a.publicSlug ?? '');
  check(
    'B3 all standee allocations assigned',
    standeeAllocations.every((a) => a.assigned && a.publicSlug),
    JSON.stringify(standeeAllocations.map((a) => a.assigned))
  );
  check('B3 standee slugs unique', new Set(standeeSlugs).size === standeeSlugs.length, `${new Set(standeeSlugs).size}/${standeeSlugs.length}`);
  check(
    'B3 card and standee namespaces distinct',
    standeeSlugs.every((slug) => !cardSlugs.includes(slug)),
    'cross-collection'
  );

  // ── B4: sequential cross-collection collision guard ─────────────────────
  {
    const user2 = await User.create({
      name: 'Phase4 Collision Owner',
      email: 'phase4-collision@local.invalid',
      passwordHash: 'phase4-pass-123',
      role: 'customer',
      status: 'active',
      bizSlug: 'phase4-collision',
    });
    await Standee.create({
      userId: user2._id,
      name: 'Collision Standee',
      displayName: 'Collision Standee',
      routeSlug: 'phase4-collision-standee-route',
      uid: 'phase4-collision-standee-route',
      publicSlug: 'phase4-collision/business-card',
      panelQr: { qrId: 'phase4-collision-panel', qrColor: '#000000' },
      socialQrs: [],
    });
    const card = await Card.create({
      cardUid: 'PHASE4-COLLISION-CARD',
      slug: 'phase4-collision-card',
      userId: user2._id,
      assignedUserId: user2._id,
      status: 'active',
      isActive: true,
      kind: 'profile',
      routeSlug: 'phase4-collision-card-route',
      uid: 'phase4-collision-card-route',
    });
    await UserProduct.create({
      userId: user2._id,
      catalogProductId: businessProduct._id,
      cardId: card._id,
      quantity: 1,
      status: 'active',
    });
    const allocation = await ensureCardPublicSlug(card._id, user2._id);
    check(
      'B4 cross-collection collision is avoided',
      allocation.assigned && allocation.publicSlug !== 'phase4-collision/business-card',
      String(allocation.publicSlug)
    );
  }

  // ── B5: reserved namespace invariants ───────────────────────────────────
  check(
    'B5 standee segments are reserved',
    STANDEES_PUBLIC_PRODUCT_SEGMENT === 'standee' &&
      STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT === 'review-standee' &&
      getPublicProductSlug(STANDEES_PUBLIC_PRODUCT_SEGMENT) === null &&
      getPublicProductSlug(STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT) === null,
    `${STANDEES_PUBLIC_PRODUCT_SEGMENT}/${STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT}`
  );

  // ── B6: failed allocation leaves assignment/card untouched ──────────────
  {
    const orphan = await Card.create({
      cardUid: 'PHASE4-ORPHAN-ALLOC',
      slug: 'phase4-orphan-alloc',
      userId: user._id,
      assignedUserId: user._id,
      status: 'active',
      isActive: true,
      kind: 'profile',
      routeSlug: 'phase4-orphan-alloc-route',
      uid: 'phase4-orphan-alloc-route',
    });
    const before = orphan.toObject();
    const result = await ensureCardPublicSlug(orphan._id, user._id);
    const after = await Card.findById(orphan._id).lean<any>();
    check('B6 allocation without active assignment fails safely', !result.assigned, String(result.assigned));
    check('B6 failed allocation does not set publicSlug', !after?.publicSlug, String(after?.publicSlug));
    check(
      'B6 failed allocation does not change identifiers/ownership',
      after?.routeSlug === before.routeSlug &&
        after?.uid === before.uid &&
        String(after?.userId) === String(before.userId),
      'identifiers'
    );
  }

  // ── B7: no duplicates after stress ──────────────────────────────────────
  {
    const allCards = await Card.find({ publicSlug: { $exists: true, $ne: '' } })
      .select('publicSlug')
      .lean<any[]>();
    const allStandees = await Standee.find({ publicSlug: { $exists: true, $ne: '' } })
      .select('publicSlug')
      .lean<any[]>();
    const all = [...allCards, ...allStandees].map((r) => r.publicSlug);
    check('B7 no duplicate public URLs after concurrency', new Set(all).size === all.length, `${new Set(all).size}/${all.length}`);
  }

  // ── C: existing route contracts ─────────────────────────────────────────
  const profileCard = await Card.create({
    cardUid: 'PHASE4-ROUTE-PROFILE-UID',
    slug: 'phase4-profile-slug',
    urlAlias: 'phase4-profile-alias',
    publicSlug: 'phase4-url-owner/premium-card',
    userId: user._id,
    assignedUserId: user._id,
    status: 'active',
    isActive: true,
    kind: 'profile',
    routeSlug: 'phase4-profile-route',
    uid: 'phase4-profile-route',
  });
  const profileRoute = await route('/r/phase4-profile-route');
  check(
    'C profile /r/{routeSlug} redirects to branded publicSlug',
    profileRoute.status === 307 && profileRoute.location.includes('/phase4-url-owner/premium-card'),
    `${profileRoute.status} ${profileRoute.location}`
  );
  check(
    'C /{business}/{product} resolves the card',
    Boolean(await getPublicCardByPublicSlug('phase4-url-owner/premium-card')),
    'publicSlug'
  );
  check(
    'C /profile/{alias} resolves the card',
    Boolean(await resolvePublicCardProfile('phase4-profile-alias')),
    'profile alias'
  );

  const legacyCard = await Card.create({
    cardUid: 'PHASE4-ROUTE-LEGACY-UID',
    slug: 'phase4-legacy-slug',
    userId: user._id,
    assignedUserId: user._id,
    status: 'active',
    isActive: true,
    kind: 'profile',
  });
  const legacyRoute = await route('/r/PHASE4-ROUTE-LEGACY-UID');
  check(
    'C legacy /r/{cardUid} still redirects to /c/{slug}',
    legacyRoute.status === 307 && legacyRoute.location.includes('/c/phase4-legacy-slug'),
    `${legacyRoute.status} ${legacyRoute.location}`
  );
  check(
    'C /c/{slug} still resolves the legacy card',
    Boolean(await getPublicCardByAlias('phase4-legacy-slug')),
    'legacy slug'
  );

  // Raw insert intentionally omits isActive, matching the legacy records that
  // predate the lifecycle field. Mongoose.create would apply the schema default.
  const hiddenLegacyId = new mongoose.Types.ObjectId();
  await mongoose.connection.collection('cards').insertOne({
    _id: hiddenLegacyId,
    cardUid: 'PHASE4-HIDDEN-UID',
    slug: 'phase4-hidden-slug',
    userId: user._id,
    assignedUserId: user._id,
    status: 'active',
    kind: 'profile',
  });
  const hiddenRoute = await route('/r/PHASE4-HIDDEN-UID');
  check(
    'C legacy card with missing isActive remains non-public',
    hiddenRoute.status === 404 && (await getPublicCardByAlias('phase4-hidden-slug')) === null,
    `${hiddenRoute.status}`
  );

  await ReviewSettings.create({
    businessId: user._id,
    updatedBy: user._id,
    schemaVersion: 1,
    general: {
      enabled: true,
      googleReviewUrl: 'https://example.test/phase4-central-review',
      welcomeMessage: 'Central welcome',
      businessName: 'Phase4 URL Owner',
    },
    content: {
      category: '',
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
  });
  const reviewCard = await Card.create({
    cardUid: 'PHASE4-ROUTE-REVIEW-UID',
    slug: 'phase4-review-slug',
    urlAlias: 'phase4-review-alias',
    publicSlug: 'phase4-url-owner/google-review',
    userId: user._id,
    assignedUserId: user._id,
    status: 'active',
    isActive: true,
    kind: 'review',
    routeSlug: 'phase4-review-route',
    uid: 'phase4-review-route',
    reviewSettingsSource: 'legacy',
    reviewAssistant: {
      enabled: true,
      googleReviewUrl: 'https://example.test/phase4-legacy-review',
      writingStyle: 'friendly',
      preferredLength: 'medium',
      languages: ['English'],
      feedbackTopics: [],
      welcomeMessage: 'Legacy welcome',
      category: '',
      employees: [],
      services: [],
      keywords: [],
    },
  });
  await UserProduct.create({
    userId: user._id,
    catalogProductId: reviewProduct._id,
    cardId: reviewCard._id,
    quantity: 1,
    status: 'active',
  });
  const reviewRoute = await route('/r/phase4-review-route');
  check(
    'C review /r/{routeSlug} redirects to /review/{alias}',
    reviewRoute.status === 307 && reviewRoute.location.includes('/review/phase4-review-alias'),
    `${reviewRoute.status} ${reviewRoute.location}`
  );
  const [entitled, effective] = await Promise.all([
    getCardReviewEntitlement(reviewCard),
    resolveEffectiveReviewSettings(reviewCard),
  ]);
  check(
    'C published central review is available',
    entitled.entitled && effective.enabled && effective.source === 'central',
    `${entitled.entitled}/${effective.enabled}/${effective.source}`
  );
  await ReviewSettings.updateOne(
    { businessId: user._id },
    { $set: { 'general.enabled': false } }
  );
  const unpublished = await resolveEffectiveReviewSettings(reviewCard);
  check('C unpublished central review fails closed', unpublished.enabled === false, String(unpublished.enabled));

  const legacyOnlyUser = await User.create({
    name: 'Phase4 Legacy Review',
    email: 'phase4-legacy-review@local.invalid',
    passwordHash: 'phase4-pass-123',
    role: 'customer',
    status: 'active',
    bizSlug: 'phase4-legacy-review',
  });
  const legacyReviewCard = await Card.create({
    cardUid: 'PHASE4-LEGACY-REVIEW-UID',
    slug: 'phase4-legacy-review-slug',
    urlAlias: 'phase4-legacy-review-alias',
    userId: legacyOnlyUser._id,
    assignedUserId: legacyOnlyUser._id,
    status: 'active',
    isActive: true,
    kind: 'review',
    routeSlug: 'phase4-legacy-review-route',
    uid: 'phase4-legacy-review-route',
    reviewAssistant: {
      enabled: true,
      googleReviewUrl: 'https://example.test/phase4-legacy-only',
      writingStyle: 'friendly',
      preferredLength: 'medium',
      languages: ['English'],
      feedbackTopics: [],
      welcomeMessage: 'Legacy only',
      category: '',
      employees: [],
      services: [],
      keywords: [],
    },
  });
  await UserProduct.create({
    userId: legacyOnlyUser._id,
    catalogProductId: reviewProduct._id,
    cardId: legacyReviewCard._id,
    quantity: 1,
    status: 'active',
  });
  const legacyOnly = await resolveEffectiveReviewSettings(legacyReviewCard);
  check(
    'C legacy-only review remains stored but unpublished',
    legacyOnly.enabled === false && legacyOnly.source === 'legacy-fallback',
    `${legacyOnly.enabled}/${legacyOnly.source}`
  );

  const standee = await Standee.create({
    userId: user._id,
    name: 'Phase4 Route Standee',
    displayName: 'Phase4 Route Standee',
    routeSlug: 'phase4-route-standee',
    uid: 'phase4-route-standee',
    publicSlug: 'phase4-url-owner/standee-1',
    productKey: 'GOOGLE_REVIEW_STANDEE',
    maxProfiles: 1,
    fixedProfiles: ['google_review'],
    panelQr: { qrId: 'phase4-route-standee-panel', qrColor: '#000000' },
    socialQrs: [
      {
        qrId: 'phase4-route-standee-slot',
        platform: 'google_review',
        label: 'Google Review',
        qrColor: '#000000',
        destinationUrl: 'https://example.test/phase4-route-standee-google',
      },
    ],
  });
  await UserProduct.create({
    userId: user._id,
    catalogProductId: reviewStandeeProduct._id,
    standeeId: standee._id,
    quantity: 1,
    status: 'active',
  });
  const panelStandee = await getPublicStandeeByPublicSlug('phase4-url-owner/standee-1');
  const panel = panelStandee
    ? resolveStandeePanel(panelStandee as never, 'Phase4 URL Owner', ['google_review'])
    : null;
  check('C standee panel publicSlug resolves', Boolean(panel), 'panel');
  check(
    'C standee panel keeps /r/{routeSlug}/{slot}',
    panel?.slots?.[0]?.href === '/r/phase4-route-standee/1',
    JSON.stringify(panel?.slots)
  );
  await ReviewSettings.updateOne(
    { businessId: user._id },
    { $set: { 'general.enabled': true } }
  );
  const host = await resolveStandeeReviewHost('phase4-route-standee');
  check(
    'C standee review host resolves from central + slot destination',
    Boolean(host) &&
      host?.config.googleReviewUrl === 'https://example.test/phase4-route-standee-google',
    host?.config.googleReviewUrl ?? 'none'
  );

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n=== PHASE 4 URL CONCURRENCY + ROUTES ===`);
  console.log(JSON.stringify({ checks: results.length, passed, failed: results.length - passed, failures: results.filter((r) => !r.pass) }, null, 2));
  await mongoose.disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
