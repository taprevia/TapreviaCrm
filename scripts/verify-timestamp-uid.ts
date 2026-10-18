/**
 * verify-timestamp-uid.ts — verification harness for the timestamp-UID feature.
 *
 * Verifies:
 *  - `generateTimestampUid()` shape (short, lowercase base36) and uniqueness;
 *  - `generateUniqueTimestampUid()` retries when a candidate is taken;
 *  - NEW card assignments stamp `uid` === `routeSlug` with a timestamp UID while
 *    preserving the admin-supplied physical `cardUid`;
 *  - DIGITAL-FIRST card assignments (no physical UID supplied) mint a synthetic
 *    `DIGITAL-…` cardUid while still stamping `uid` === `routeSlug`;
 *  - NEW standee assignments stamp `uid` === `routeSlug` with a timestamp UID;
 *  - both NEW (uid) and LEGACY (routeSlug-only) identifiers resolve through the
 *    same dual-track `$or` query used by the resolvers.
 *
 * Non-destructive: only touches its own fixture user and the records it creates.
 *
 * Run with: npx tsx scripts/verify-timestamp-uid.ts  (or `npm run test:uid`)
 * Exits non-zero if any assertion fails.
 */

import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { provisionCardForAssignment } from '@/lib/services/card-identity';
import { generateTimestampUid, generateUniqueTimestampUid } from '@/lib/uid';

const TS_UID = /^[a-z0-9]{8,12}$/;
const TEST_EMAIL = 'verify.uid.timestamp@taprevia.com';

let passes = 0;
let failures = 0;

function report(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function cleanupUser(userId: unknown): Promise<void> {
  await Standee.deleteMany({ userId });
  await Card.deleteMany({ $or: [{ userId }, { assignedUserId: userId }] });
  await UserProduct.deleteMany({ userId });
}

async function run() {
  await connectDB();

  /* ═══ 1. Generator: shape + timestamp prefix + collision retry ═══ */
  const sample = generateTimestampUid();
  report('1a. generator shape is short lowercase base36', TS_UID.test(sample), `sample=${sample}`);

  // The prefix (timestamp minus the 2 default entropy chars) must decode back
  // to a recent base36 millisecond timestamp.
  const tsPart = sample.slice(0, sample.length - 2);
  const decoded = parseInt(tsPart, 36);
  report(
    '1b. timestamp prefix decodes to "now"',
    Number.isFinite(decoded) && Math.abs(Date.now() - decoded) < 5000,
    `decoded=${decoded}`
  );

  let attempts = 0;
  const retried = await generateUniqueTimestampUid(async () => {
    attempts += 1;
    return attempts <= 2; // first two candidates are "taken"
  });
  report('1c. unique allocator retries taken candidates', attempts === 3 && TS_UID.test(retried), `attempts=${attempts}`);

  // The allocator (as used by real assignments) must yield unique ids even in a
  // tight burst within the same millisecond.
  const burst = new Set<string>();
  for (let i = 0; i < 50; i++) {
    // eslint-disable-next-line no-await-in-loop
    burst.add(await generateUniqueTimestampUid(async (candidate) => burst.has(candidate)));
  }
  report('1d. allocator yields unique ids under burst', burst.size === 50, `unique=${burst.size}`);

  /* ═══ 2. Fixture user ═══ */
  const stale = await User.findOne({ email: TEST_EMAIL });
  if (stale) {
    await cleanupUser(stale._id);
    await User.deleteOne({ _id: stale._id });
  }
  const user = await User.create({
    name: 'UID Verify',
    email: TEST_EMAIL,
    passwordHash: 'x',
    role: 'customer',
    status: 'active',
  });

  /* ═══ 3. Standee assignment (assignUserProduct) ═══ */
  const cat = (await CatalogProduct.findOne({ slug: 'all-in-one-standee-3' }).lean()) as never;
  const standeeRes = await assignUserProduct({
    user,
    catalogItem: cat as never,
    quantity: 1,
    assignedBy: String(user._id),
  });
  report('3a. standee assigned', standeeRes.ok);
  if (standeeRes.ok && standeeRes.data.standee) {
    const s = standeeRes.data.standee;
    report('3b. standee uid is a timestamp UID', !!s.uid && TS_UID.test(s.uid), `uid=${s.uid}`);
    report('3c. standee uid mirrors routeSlug', s.uid === s.routeSlug, `uid=${s.uid} routeSlug=${s.routeSlug}`);

    const key = (s.uid ?? '').toLowerCase();
    const found = await Standee.findOne({
      $or: [{ $expr: { $eq: [{ $toLower: '$routeSlug' }, key] } }, { uid: key }],
    });
    report('3d. standee resolves via new uid (dual-track)', !!found && String(found._id) === String(s._id));
  }

  /* ═══ 4. Card provisioning (admin-supplied hardware UID) ═══ */
  const hardwareUid = `TMPHW${Date.now().toString(36).toUpperCase()}`;
  const cardRes = await provisionCardForAssignment({
    uid: hardwareUid,
    userId: String(user._id),
    userName: user.name,
    productName: 'UID Verify Card',
    kind: 'profile',
  });
  report('4a. card provisioned', cardRes.ok);
  if (cardRes.ok) {
    const c = cardRes.card;
    report('4b. card uid is a timestamp UID', !!c.uid && TS_UID.test(c.uid), `uid=${c.uid}`);
    report('4c. card uid mirrors routeSlug', c.uid === c.routeSlug, `uid=${c.uid} routeSlug=${c.routeSlug}`);
    report('4d. physical cardUid preserved verbatim', c.cardUid === hardwareUid, `cardUid=${c.cardUid}`);

    const key = (c.uid ?? '').toLowerCase();
    const found = await Card.findOne({ isActive: true, $or: [{ routeSlug: key }, { uid: key }] });
    report('4e. card resolves via new uid (dual-track)', !!found && String(found._id) === String(c._id));
  }

  /* ═══ 4b. Digital-first card assignment (no physical UID supplied) ═══ */
  const digitalCat = await CatalogProduct.findOne({ category: 'card', active: true }).lean();
  if (digitalCat) {
    const digitalRes = await assignUserProduct({
      user,
      catalogItem: digitalCat as never,
      quantity: 1,
      assignedBy: String(user._id),
    });
    report('4f. digital-first card assigned (no UID supplied)', digitalRes.ok);
    if (digitalRes.ok && digitalRes.data.card) {
      const d = digitalRes.data.card;
      report('4g. digital card uid is a timestamp UID', !!d.uid && TS_UID.test(d.uid), `uid=${d.uid}`);
      report('4h. digital card uid mirrors routeSlug', d.uid === d.routeSlug, `uid=${d.uid} routeSlug=${d.routeSlug}`);
      report(
        '4i. digital card cardUid is a synthetic DIGITAL- placeholder',
        typeof d.cardUid === 'string' && d.cardUid.startsWith('DIGITAL-'),
        `cardUid=${d.cardUid}`
      );

      const digitalKey = (d.uid ?? '').toLowerCase();
      const foundDigital = await Card.findOne({
        isActive: true,
        $or: [{ routeSlug: digitalKey }, { uid: digitalKey }],
      });
      report(
        '4j. digital card resolves via new uid (dual-track)',
        !!foundDigital && String(foundDigital._id) === String(d._id)
      );
    }
  } else {
    console.log('  (no card-category catalog product seeded — 4f-4j skipped)');
  }

  /* ═══ 5. Legacy record (routeSlug only, no uid) still resolves ═══ */
  const legacy = await Card.create({
    cardUid: `LEGACY${Date.now().toString(36).toUpperCase()}`,
    slug: `legacy-uid-${Date.now().toString(36)}`,
    routeSlug: `legacyroute${Date.now().toString(36)}`,
    kind: 'profile',
    isActive: true,
  });
  const foundLegacy = await Card.findOne({
    isActive: true,
    $or: [{ routeSlug: legacy.routeSlug }, { uid: legacy.routeSlug }],
  });
  report('5a. legacy routeSlug resolves with no uid present', !!foundLegacy && String(foundLegacy._id) === String(legacy._id));
  await Card.deleteOne({ _id: legacy._id });

  /* ═══ cleanup ═══ */
  await cleanupUser(user._id);
  await User.deleteOne({ _id: user._id });
  await mongoose.disconnect();

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Verify run crashed:', error);
  process.exit(2);
});
