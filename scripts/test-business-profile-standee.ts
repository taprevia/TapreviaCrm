/**
 * Business Profile Standee provisioning + linked profile Card tests.
 *
 * Self-contained disposable-DB integration test. Connects to a throwaway
 * database (taprevia_bps_test), seeds the reservation-readiness prerequisites
 * and a BPS catalog product, exercises the real assignment path, asserts the
 * linkage/entitlement/resolution, then DROPS the database. It never touches
 * the real local dev data.
 *
 * Run: npx tsx scripts/test-business-profile-standee.ts
 */

import mongoose from 'mongoose';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import Counter from '@/models/Counter';
import PublicUrlReservation from '@/models/PublicUrlReservation';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';
import { resolveFeatureAccess } from '@/lib/services/feature-access';
import { getProductCapabilities, getProductDef } from '@/config/products';
import { resolveBusinessProfileStandeeDestination } from '@/lib/services/standee-profile-resolution';
import {
  resolveStandeePreview,
  resolveProductUrls,
} from '@/lib/services/product-preview';
import { isDigitalCardUid } from '@/lib/services/card-identity';
import { PUBLIC_URL_RESERVATION_READY_KEY } from '@/lib/services/public-url-reservation';

const DB = 'taprevia_bps_test';
const MONGODB_URI = 'mongodb://127.0.0.1:27017';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const ADMIN_ID = new mongoose.Types.ObjectId().toString();
const email = (tag: string) => `bps-${tag}-${Date.now()}@example.test`;

async function main(): Promise<void> {
  await mongoose.connect(`${MONGODB_URI}/${DB}`, {
    serverSelectionTimeoutMS: 5000,
  });
  // Start from a clean disposable database on every run.
  await mongoose.connection.dropDatabase().catch(() => undefined);

  // Reservation-readiness prerequisites (what the controlled backfill step
  // writes in a real environment): unique path index + activation marker.
  await PublicUrlReservation.collection.createIndex({ path: 1 }, { unique: true });
  await Counter.findOneAndUpdate(
    { _id: PUBLIC_URL_RESERVATION_READY_KEY },
    { $setOnInsert: { seq: 0 } },
    { upsert: true, new: true }
  );

  console.log('\n── 1. Catalog capability configuration ──');
  const caps = getProductCapabilities('BUSINESS_PROFILE_STANDEE');
  check('review_ai_suggestions granted', caps.includes('review_ai_suggestions'));
  check('profile_edit granted', caps.includes('profile_edit'));
  check('social_links granted', caps.includes('social_links'));
  check('contact_save granted', caps.includes('contact_save'));
  check('catalogue granted', caps.includes('catalogue'));
  check('portfolio granted', caps.includes('portfolio'));
  check('tap_analytics granted', caps.includes('tap_analytics'));
  check('dynamic_dashboard granted', caps.includes('dynamic_dashboard'));
  check('publicSlug = business-profile', getProductDef('BUSINESS_PROFILE_STANDEE').publicSlug === 'business-profile');

  const catalog = await CatalogProduct.create({
    name: 'Business Profile Standee',
    slug: 'business-profile-standee',
    category: 'standee',
    kind: 'standee',
    active: true,
    priceMinor: 0,
  });

  console.log('\n── 2. BPS assignment provisions linked profile Card ──');
  const res = await createCustomerWithProducts({
    name: 'BPS Test',
    email: email('main'),
    password: 'test-pass-123',
    products: [{ catalogProductId: catalog._id.toString() }],
    assignedBy: ADMIN_ID,
  });
  check('creation succeeds', res.ok, res.ok ? undefined : res);

  if (res.ok) {
    const ownerId = String((res.data as { user: { _id: unknown } }).user._id);
    const standee = await Standee.findOne({ userId: ownerId });
    check('one Standee created', !!standee);
    check('standee.productKey is BPS', standee?.productKey === 'BUSINESS_PROFILE_STANDEE', standee?.productKey);
    check('standee.cardId set', !!standee?.cardId, standee?.cardId);
    // BPS is card-backed: no obsolete WhatsApp social QR slots or fixed slots.
    check('standee.fixedProfiles is empty', Array.isArray(standee?.fixedProfiles) && standee.fixedProfiles.length === 0, standee?.fixedProfiles);
    check('standee.socialQrs is empty', Array.isArray(standee?.socialQrs) && standee.socialQrs.length === 0, standee?.socialQrs);
    check('standee.maxProfiles is 0', standee?.maxProfiles === 0, standee?.maxProfiles);
    check('standee.panelQr preserved', Boolean(standee?.panelQr?.qrId), standee?.panelQr?.qrId);

    const card = standee?.cardId ? await Card.findById(standee.cardId) : null;
    check('linked Card exists', !!card);
    check('linked Card kind = profile', card?.kind === 'profile', card?.kind);
    check('linked Card owned by user', !!card && String(card.userId) === ownerId);
    check('linked Card active', !!card && card.status === 'active' && card.isActive === true);
    check('linked Card digital UID', !!card && isDigitalCardUid(card.cardUid), card?.cardUid);
    check('linked Card has publicSlug', !!card && !!card.publicSlug, card?.publicSlug);
    check('linked Card has urlAlias', !!card && !!card.urlAlias, card?.urlAlias);

    const up = await UserProduct.findOne({ userId: ownerId, catalogProductId: catalog._id });
    check('UserProduct links Card (cardId)', !!up?.cardId, up?.cardId);
    check('UserProduct links Standee (standeeId)', !!up?.standeeId, up?.standeeId);
    check('UserProduct cardId == standee.cardId', !!up && !!standee && String(up.cardId) === String(standee.cardId));

    console.log('\n── 3. Feature-key grants ──');
    const feats = await resolveFeatureAccess(ownerId);
    check('profile enabled', feats.profile.enabled === true);
    check('social enabled', feats.social.enabled === true);
    check('review enabled', feats.review.enabled === true);
    check('standee enabled', feats.standee.enabled === true);
    check('social max = 6', feats.social.max === 6, feats.social.max);

    console.log('\n── 4. Public destination resolution ──');
    if (card && standee) {
      const dest = await resolveBusinessProfileStandeeDestination({
        userId: ownerId,
        productKey: 'BUSINESS_PROFILE_STANDEE',
        cardId: card._id,
      });
      check('destination resolves', !!dest, dest);
      check('destination is the card publicSlug', dest === (card.publicSlug ? `/${card.publicSlug}` : dest), dest);

      console.log('\n── 5. Fail-closed security ──');
      const foreignDest = await resolveBusinessProfileStandeeDestination({
        userId: new mongoose.Types.ObjectId(), // unrelated owner id
        productKey: 'BUSINESS_PROFILE_STANDEE',
        cardId: card._id,
      });
      check('foreign owner rejected (null)', foreignDest === null);

      const wrongProduct = await resolveBusinessProfileStandeeDestination({
        userId: ownerId,
        productKey: 'GOOGLE_REVIEW_STANDEE',
        cardId: card._id,
      });
      check('wrong productKey rejected (null)', wrongProduct === null);

      const noCard = await resolveBusinessProfileStandeeDestination({
        userId: ownerId,
        productKey: 'BUSINESS_PROFILE_STANDEE',
        cardId: undefined,
      });
      check('missing cardId rejected (null)', noCard === null);

      console.log('\n── 6. URL display alignment (publicUrl + preview) ──');
      const linkedSlug = String(card.publicSlug ?? '');

      // Linked BPS preview resolves to the business profile, not the standee
      // redirect slug. This is what the Standee section/Manage/Preview show.
      const linkedPreview = await resolveStandeePreview({
        routeSlug: standee.routeSlug,
        publicSlug: standee.publicSlug,
        linkedCardPublicSlug: linkedSlug,
      });
      check('linked BPS preview kind = profile', linkedPreview.ok && linkedPreview.kind === 'profile', linkedPreview);
      check(
        'linked BPS preview href = /{card.publicSlug}',
        linkedPreview.ok && linkedPreview.href === `/${linkedSlug}`,
        linkedPreview.ok ? linkedPreview.href : linkedPreview
      );

      // Unlinked legacy standee keeps its own publicSlug fallback.
      const legacyPreview = await resolveStandeePreview({
        publicSlug: standee.publicSlug,
      });
      check(
        'legacy unlinked standee preview = /{standee.publicSlug}',
        legacyPreview.ok &&
          legacyPreview.kind === 'standee' &&
          legacyPreview.href === `/${standee.publicSlug}`,
        legacyPreview
      );

      // resolveProductUrls propagates the linked slug into canonical + preview.
      const urls = await resolveProductUrls({
        instanceType: 'standee',
        instance: {
          routeSlug: standee.routeSlug,
          uid: standee.uid,
          publicSlug: standee.publicSlug,
        },
        linkedCardPublicSlug: linkedSlug,
      });
      check('canonicalPublicUrl = linked card URL', urls.canonicalPublicUrl === `/${linkedSlug}`, urls.canonicalPublicUrl);
      check('previewUrl = linked card URL', urls.previewUrl === `/${linkedSlug}`, urls.previewUrl);

      // Another standee (no linked slug) keeps its own publicSlug.
      const otherUrls = await resolveProductUrls({
        instanceType: 'standee',
        instance: {
          publicSlug: standee.publicSlug,
          productKey: 'GOOGLE_REVIEW_STANDEE',
        },
      });
      check(
        'other standee canonicalPublicUrl = own publicSlug',
        otherUrls.canonicalPublicUrl === `/${standee.publicSlug}`,
        otherUrls.canonicalPublicUrl
      );
    }
  }

  console.log('\n── Cleanup (drop disposable DB) ──');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log('  dropped taprevia_bps_test');

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`PASSED ${passed}  FAILED ${failed}`);
  if (failures.length) {
    console.log('Failed checks:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
