/**
 * Smoke-test fixture setup (LOCAL disposable DB only).
 *
 * Seeds a throwaway `taprevia_bps_smoke` database with:
 *   - the permanent-URL reservation readiness marker + unique path index,
 *   - a Business Profile Standee (→ linked profile Card),
 *   - a Premium NFC Card,
 *   - a Google Review Standee,
 * and prints their public identifiers for the HTTP smoke test.
 *
 * This is a testing-phase fixture; it never touches real customer data and is
 * safe to drop afterwards.
 */

import mongoose from 'mongoose';
import User from '@/models/User';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import CatalogProduct from '@/models/CatalogProduct';
import Counter from '@/models/Counter';
import PublicUrlReservation from '@/models/PublicUrlReservation';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';

const URI = 'mongodb://127.0.0.1:27017/taprevia_bps_smoke';
const ADMIN_ID = new mongoose.Types.ObjectId().toString();

async function main(): Promise<void> {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();

  // Reservation readiness (mirrors the controlled backfill activation step).
  await PublicUrlReservation.collection.createIndex({ path: 1 }, { unique: true });
  await Counter.findOneAndUpdate(
    { _id: 'public-url-reservation:ready' },
    { $setOnInsert: { seq: 0 } },
    { upsert: true, new: true }
  );

  const [bps, premium, reviewStandee] = await CatalogProduct.create([
    { name: 'Business Profile Standee', slug: 'business-profile-standee', category: 'standee', kind: 'standee', active: true, priceMinor: 0 },
    { name: 'Premium NFC Card', slug: 'premium-nfc-card', category: 'card', kind: 'profile', active: true, priceMinor: 0 },
    { name: 'Google Review Standee', slug: 'google-review-standee', category: 'standee', kind: 'standee', active: true, priceMinor: 0 },
  ]);

  const mk = (tag: string) => `smoke-${tag}-${Date.now()}@example.test`;

  // 1. Business Profile Standee (linked Card).
  const bpsRes = await createCustomerWithProducts({
    name: 'Smoke BPS',
    email: mk('bps'),
    password: 'test-pass-123',
    products: [{ catalogProductId: bps._id.toString() }],
    assignedBy: ADMIN_ID,
  });
  if (!bpsRes.ok) throw new Error('BPS assignment failed: ' + bpsRes.error);
  const bpsUserId = String((bpsRes.data as { user: { _id: unknown } }).user._id);
  const bpsStandee = await Standee.findOne({ userId: bpsUserId });
  const bpsCard = bpsStandee?.cardId ? await Card.findById(bpsStandee.cardId) : null;

  // 2. Premium NFC Card (direct visit comparison).
  const premiumRes = await createCustomerWithProducts({
    name: 'Smoke Premium',
    email: mk('premium'),
    password: 'test-pass-123',
    products: [{ catalogProductId: premium._id.toString() }],
    assignedBy: ADMIN_ID,
  });
  if (!premiumRes.ok) throw new Error('Premium assignment failed: ' + premiumRes.error);
  const premiumUserId = String((premiumRes.data as { user: { _id: unknown } }).user._id);
  const premiumCard = await Card.findOne({ userId: premiumUserId, kind: 'profile' });

  // 3. Google Review Standee (unchanged comparison).
  const grRes = await createCustomerWithProducts({
    name: 'Smoke GR Standee',
    email: mk('gr'),
    password: 'test-pass-123',
    products: [{ catalogProductId: reviewStandee._id.toString() }],
    assignedBy: ADMIN_ID,
  });
  if (!grRes.ok) throw new Error('GR standee assignment failed: ' + grRes.error);
  const grUserId = String((grRes.data as { user: { _id: unknown } }).user._id);
  const grStandee = await Standee.findOne({ userId: grUserId });

  const summary = {
    bps: {
      userId: bpsUserId,
      standeeId: String(bpsStandee?._id),
      standeeRouteSlug: bpsStandee?.routeSlug ?? null,
      standeePublicSlug: bpsStandee?.publicSlug ?? null,
      cardId: bpsCard ? String(bpsCard._id) : null,
      cardPublicSlug: bpsCard?.publicSlug ?? null,
      cardKind: bpsCard?.kind ?? null,
    },
    premium: {
      userId: premiumUserId,
      cardId: premiumCard ? String(premiumCard._id) : null,
      cardPublicSlug: premiumCard?.publicSlug ?? null,
    },
    googleReview: {
      userId: grUserId,
      standeeId: String(grStandee?._id),
      standeeRouteSlug: grStandee?.routeSlug ?? null,
    },
  };

  console.log('SMOKE_SUMMARY ' + JSON.stringify(summary));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
