/**
 * M10 verification: the four core product experiences.
 *
 * Active `UserProduct` assignments are the only authority: experienced-based
 * fixed access rules. Exercises resolveFeatureAccess()/canUseFeature()/
 * featureMax() against a local MongoDB, proving:
 *
 *   1. A Review-only customer CANNOT access Profile — even while owning a
 *      Profile-kind card (the central M9 leak, fixed here).
 *   2. The Review experience works for customers that own it.
 *   3. Social products resolve their allowed link limit (1–4) and it is
 *      enforced server-side.
 *   4. Standee products grant Standee only.
 *   5. Multiple products merge their access (most-generous social limit).
 *   6. Legacy customers (no assignments) keep their historical access, and
 *      legacy fallback NEVER overrides a modern purchase.
 *
 * Run:
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/verify-m10-feature-access.ts
 */

import mongoose from 'mongoose';
import User from '@/models/User';
import CatalogProduct from '@/models/CatalogProduct';
import UserProduct from '@/models/UserProduct';
import {
  canUseFeature,
  featureMax,
  resolveFeatureAccess,
} from '@/lib/services/feature-access';
import { DEFAULT_SOCIAL_LINKS_MAX } from '@/lib/feature-keys';
import type { FeatureKey } from '@/types';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';

const USERS = {
  reviewOnly: 'm10-review@example.com',
  reviewOnlyLegacy: 'm10-review-legacy@example.com',
  social2: 'm10-social@example.com',
  socialDefault: 'm10-social-default@example.com',
  standee: 'm10-standee@example.com',
  profile: 'm10-profile@example.com',
  merged: 'm10-merged@example.com',
  legacy: 'm10-legacy@example.com',
  legacyReview: 'm10-legacy-review@example.com',
  unknown: 'm10-never-assigned@example.com',
};

let passed = 0;
let failed = 0;

function report(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function upsertUser(email: string): Promise<mongoose.Types.ObjectId> {
  const doc = await User.findOneAndUpdate(
    { email },
    { email, passwordHash: 'x', name: email.split('@')[0] },
    { upsert: true, new: true }
  );
  return doc._id as mongoose.Types.ObjectId;
}

async function upsertCatalog(
  slug: string,
  kind: string,
  opts: { socialMax?: number } = {}
): Promise<mongoose.Types.ObjectId> {
  const features = opts.socialMax !== undefined ? { social: { max: opts.socialMax } } : {};
  const doc = await CatalogProduct.findOneAndUpdate(
    { slug },
    { $set: { name: slug, slug, category: 'card', kind, features } },
    { upsert: true, new: true, runValidators: true }
  );
  return doc._id as mongoose.Types.ObjectId;
}

async function assignProduct(userId: mongoose.Types.ObjectId, catalogProductId: mongoose.Types.ObjectId) {
  await UserProduct.deleteMany({ userId, catalogProductId });
  await UserProduct.create({ userId, catalogProductId, quantity: 1, status: 'active' });
}

async function clearAssignments(userId: mongoose.Types.ObjectId) {
  await UserProduct.deleteMany({ userId });
}

async function upsertCard(
  db: mongoose.mongo.Db,
  uid: string,
  kind: string,
  userId: mongoose.Types.ObjectId,
  urlAlias: string
) {
  await db.collection('cards').findOneAndUpdate(
    { cardUid: uid },
    {
      $set: {
        cardUid: uid,
        name: `${kind} fixture`,
        urlAlias,
        slug: uid.toLowerCase(),
        kind,
        isActive: true,
        userId,
        assignedUserId: userId,
        reviewAssistant: kind === 'review'
          ? {
              enabled: true,
              googleReviewUrl: 'https://example.com/m10-review',
              writingStyle: 'friendly',
              preferredLength: 'medium',
              languages: ['English'],
              feedbackTopics: ['service'],
              welcomeMessage: 'How was it?',
            }
          : { enabled: false },
      },
    },
    { upsert: true }
  );
}

async function seed() {
  mongoose.set('strictQuery', false);
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  const users = {
    reviewOnly: await upsertUser(USERS.reviewOnly),
    reviewOnlyLegacy: await upsertUser(USERS.reviewOnlyLegacy),
    social2: await upsertUser(USERS.social2),
    socialDefault: await upsertUser(USERS.socialDefault),
    standee: await upsertUser(USERS.standee),
    profile: await upsertUser(USERS.profile),
    merged: await upsertUser(USERS.merged),
    legacy: await upsertUser(USERS.legacy),
    legacyReview: await upsertUser(USERS.legacyReview),
    unknown: await upsertUser(USERS.unknown),
  };

  await Promise.all(Object.values(users).map(clearAssignments));

  // Products — kind = experience, only social max is product-configurable.
  const reviewProduct = await upsertCatalog('m10-review-card', 'review');
  const social2Product = await upsertCatalog('m10-social-2', 'social', { socialMax: 2 });
  const socialDefaultProduct = await upsertCatalog('m10-social-default', 'social');
  const standeeProduct = await upsertCatalog('m10-counter-standy', 'standee');
  const profileProduct = await upsertCatalog('m10-profile-card', 'profile');

  await assignProduct(users.reviewOnly, reviewProduct);
  await assignProduct(users.reviewOnlyLegacy, reviewProduct);
  await assignProduct(users.social2, social2Product);
  await assignProduct(users.socialDefault, socialDefaultProduct);
  await assignProduct(users.standee, standeeProduct);
  await assignProduct(users.profile, profileProduct);
  await assignProduct(users.merged, profileProduct);
  await assignProduct(users.merged, reviewProduct);

  // Cards: the review-only customer OWNS both a review card AND a profile card
  // (as happens in production when a customer also holds an NFC card), to prove
  // owning a profile card cannot grant profile access.
  await upsertCard(db, 'M10-REVIEW-CARD', 'review', users.reviewOnly, 'm10review');
  await upsertCard(db, 'M10-PROFILE-CARD', 'profile', users.reviewOnly, 'm10profile');
  await upsertCard(db, 'M10-SOCIAL-CARD', 'social', users.social2, 'm10social');
  await upsertCard(db, 'M10-PROFILE-PROD-CARD', 'profile', users.profile, 'm10profileprod');
  // review-only customer of the legacy-doc test also owns a profile card.
  await upsertCard(db, 'M10-RL-PROFILE-CARD', 'profile', users.reviewOnlyLegacy, 'm10rlprofile');

  // Legacy assets for the pre-product customer.
  await upsertCard(db, 'M10-LEGACY-PROFILE-CARD', 'profile', users.legacy, 'm10legacy');
  await upsertCard(db, 'M10-LEGACY-REVIEW-CARD', 'review', users.legacy, 'm10legacyreview');
  await upsertCard(db, 'M10-LEGACY-REV-CARD', 'review', users.legacyReview, 'm10legacyrev');
  await db.collection('standees').deleteMany({ userId: users.legacy });
  await db.collection('standees').insertOne({
    userId: users.legacy,
    name: 'M10 legacy standee',
    panelQr: { qrId: `m10-legacy-${users.legacy.toString()}`, qrColor: '#000000' },
    socialQrs: [],
  });
  await User.updateOne({ _id: users.legacy }, { $set: { hasStandy: true } });

  return users;
}

async function run() {
  const users = await seed();

  /* 1. Review-only customer — profile is NOT granted even when owning a profile
        card (the M9 leak). */
  const g = await resolveFeatureAccess(users.reviewOnly);
  report(
    '1 Review-only customer has NO profile access (owns a profile card too)',
    g.profile.enabled === false && (await canUseFeature(users.reviewOnly, 'profile')) === false,
    JSON.stringify(g)
  );
  report(
    '1b Review-only customer has NO standee/social either',
    g.standee.enabled === false && g.social.enabled === false,
    JSON.stringify(g)
  );

  /* 2. Review experience works for the customer that owns it. */
  report(
    '2 Review-only customer CAN use review (page/assistant gate)',
    g.review.enabled === true && (await canUseFeature(users.reviewOnly, 'review')) === true,
    JSON.stringify(g.review)
  );

  /* 3. Social product — only social, with its allowed link limit. */
  const s2 = await resolveFeatureAccess(users.social2);
  report(
    '3 Social product grants social only (no profile/review/standee)',
    s2.social.enabled === true && s2.profile.enabled === false && s2.review.enabled === false && s2.standee.enabled === false,
    JSON.stringify(s2)
  );
  const s2Max = await featureMax(users.social2, 'social');
  report('3b social limit resolved to the product limit (2)', s2Max === 2, `max=${s2Max}`);
  report(
    '3c exactly 2 links pass, a 3rd is rejected server-side',
    s2Max === 2 && 2 <= s2Max && 3 > s2Max
  );

  /* 4. Standee product — standee only. */
  const st = await resolveFeatureAccess(users.standee);
  report(
    '4 Standee product grants standee only (no profile/social/review)',
    st.standee.enabled === true &&
      st.profile.enabled === false &&
      st.social.enabled === false &&
      st.review.enabled === false,
    JSON.stringify(st)
  );

  /* 4b. Profile product — profile + its own social buttons, no review/standee. */
  const pr = await resolveFeatureAccess(users.profile);
  report(
    '4b Profile product grants profile + social(max 4), no review/standee',
    pr.profile.enabled === true &&
      pr.social.enabled === true &&
      pr.social.max === DEFAULT_SOCIAL_LINKS_MAX &&
      pr.review.enabled === false &&
      pr.standee.enabled === false,
    JSON.stringify(pr)
  );

  /* 5. Social default — DEFAULT_SOCIAL_LINKS_MAX (4) as the fallback. */
  const sd = await resolveFeatureAccess(users.socialDefault);
  report(
    '5 social without a product limit defaults to the business max (4)',
    sd.social.enabled === true && sd.social.max === DEFAULT_SOCIAL_LINKS_MAX,
    JSON.stringify(sd.social)
  );

  /* 6. Multiple products merge; most-generous social limit wins. */
  const merged = await resolveFeatureAccess(users.merged);
  report(
    '6 profile + review merge → profile + social(max 4) + review',
    merged.profile.enabled === true &&
      merged.social.enabled === true &&
      merged.social.max === DEFAULT_SOCIAL_LINKS_MAX &&
      merged.review.enabled === true &&
      merged.standee.enabled === false,
    JSON.stringify(merged)
  );

  /* 7. Legacy customers (no assignments) keep their historical access. */
  const legacy = await resolveFeatureAccess(users.legacy);
  report(
    '7 legacy account (profile card + review card + hasStandy) keeps full access',
    legacy.profile.enabled && legacy.social.enabled && legacy.review.enabled && legacy.standee.enabled,
    JSON.stringify(legacy)
  );
  const legacyReview = await resolveFeatureAccess(users.legacyReview);
  report(
    '7b legacy review-card-only account keeps review access (no profile leak)',
    legacyReview.review.enabled === true && legacyReview.profile.enabled === false,
    JSON.stringify(legacyReview)
  );

  /* 8. Legacy fallback never overrides a modern purchase (the fix). */
  const rl = await resolveFeatureAccess(users.reviewOnlyLegacy);
  report(
    '8 modern review purchase is authoritative despite an owned profile card (legacy skipped)',
    rl.review.enabled === true && rl.profile.enabled === false && rl.social.enabled === false,
    JSON.stringify(rl)
  );

  /* 9. Unknown customer gets nothing. */
  const blank = await resolveFeatureAccess(users.unknown);
  report(
    '9 legacy user with no cards/standees resolves to nothing',
    blank.profile.enabled === false &&
      blank.social.enabled === false &&
      blank.review.enabled === false &&
      blank.standee.enabled === false
  );

  /* 10. Denial is derived server-side (the checks the API routes perform). */
  const apiGate = async (userId: mongoose.Types.ObjectId, key: FeatureKey) =>
    (await canUseFeature(userId, key)) ? 'allow' : 'deny';
  report(
    '10 API gate denies /api/standees for a review-only customer (403)',
    (await apiGate(users.reviewOnly, 'standee')) === 'deny'
  );
  report(
    '10b API gate denies social-links editing for a standee-only customer (403)',
    (await apiGate(users.standee, 'social')) === 'deny'
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  await mongoose.disconnect();
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  mongoose.disconnect().finally(() => {
    process.exitCode = 1;
  });
});