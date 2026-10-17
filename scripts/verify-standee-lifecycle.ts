/**
 * verify-standee-lifecycle.ts — verification harness for the standardized
 * standee create/delete lifecycle introduced by the standee refactor.
 *
 * Verifies:
 *  - canonical creation (`assignUserProduct`) always stamps the standee with
 *    `displayName`, `routeSlug`, `productKey`, `maxProfiles` and `fixedProfiles`,
 *    and links a `UserProduct` assignment;
 *  - the owner's `hasStandy` flag and `standee_multi_profile` capability flip
 *    on/off with the lifecycle;
 *  - `deleteStandeeCascade` removes the standee, detaches + retires the linked
 *    `UserProduct` (no orphaned `standeeId`), recomputes `hasStandy`, and
 *    respects user scoping / missing ids.
 *
 * Run with: npx tsx scripts/verify-standee-lifecycle.ts
 * Exits non-zero if any assertion fails.
 */

import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { deleteStandeeCascade } from '@/lib/services/standee-deletion';
import { hasCapability } from '@/lib/services/capability-access';

let failures = 0;
let passes = 0;

function report(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TEST_EMAIL = 'verify.standee.lifecycle@taprevia.com';

async function cleanup(userId: unknown): Promise<void> {
  const ups = await UserProduct.find({ userId });
  for (const up of ups) {
    if (up.standeeId) await Standee.deleteOne({ _id: up.standeeId });
    await UserProduct.deleteOne({ _id: up._id });
  }
  await Standee.deleteMany({ userId });
  await User.updateOne({ _id: userId }, { $set: { hasStandy: false } });
}

async function getCatalog(slug: string) {
  const cat = (await CatalogProduct.findOne({ slug }).lean()) as unknown as {
    slug: string;
    name: string;
    kind: string;
    category: string;
    _id: unknown;
  } | null;
  if (!cat) throw new Error(`catalog item ${slug} not found — run npm run seed first`);
  return cat;
}

async function run() {
  await connectDB();

  let user = await User.findOne({ email: TEST_EMAIL });
  if (!user) {
    user = await User.create({
      name: 'Standee Lifecycle Verify',
      email: TEST_EMAIL,
      passwordHash: 'x',
      role: 'customer',
      status: 'active',
    });
  }
  await cleanup(user._id);
  // Re-fetch so in-memory state matches the DB (mirrors how the API routes
  // always load a fresh User before assigning).
  user = (await User.findById(user._id))!;

  const cat = await getCatalog('all-in-one-standee-3');

  /* ═══ 1. Canonical creation stamps every field + links assignment ═══ */
  const created = await assignUserProduct({
    user,
    catalogItem: cat,
    quantity: 1,
    assignedBy: String(user._id),
  });
  report('1a. assignUserProduct ok', created.ok, JSON.stringify(created).slice(0, 200));

  let standeeId: unknown;
  if (created.ok) {
    const standee = created.data.standee!;
    standeeId = standee._id;
    report('1b. displayName = catalog product name', standee.displayName === cat.name, `displayName=${standee.displayName}`);
    report('1c. productKey resolved', standee.productKey === 'ALL_IN_ONE_STANDEE_3', `productKey=${standee.productKey}`);
    report('1d. routeSlug allocated', !!standee.routeSlug, `routeSlug=${standee.routeSlug}`);
    report('1e. maxProfiles = 3', standee.maxProfiles === 3, `max=${standee.maxProfiles}`);
    report(
      '1f. fixedProfiles = google_review,instagram,facebook',
      JSON.stringify(standee.fixedProfiles) === JSON.stringify(['google_review', 'instagram', 'facebook']),
      JSON.stringify(standee.fixedProfiles)
    );
    report('1g. socialQrs length = 3', (standee.socialQrs?.length ?? 0) === 3, `len=${standee.socialQrs?.length}`);
    report('1h. UserProduct linked to standee', String(created.data.userProduct.standeeId) === String(standee._id));

    const refreshed = await User.findById(user._id);
    report('1i. user.hasStandy = true', refreshed?.hasStandy === true, `hasStandy=${refreshed?.hasStandy}`);
    report('1j. standee_multi_profile capability granted', await hasCapability(user._id, 'standee_multi_profile'));
  }

  /* ═══ 2. User-scoped delete rejects a non-owner ═══ */
  const other = await User.findOne({ email: 'verify.standee.other@taprevia.com' });
  const otherUser =
    other ??
    (await User.create({
      name: 'Other',
      email: 'verify.standee.other@taprevia.com',
      passwordHash: 'x',
      role: 'customer',
      status: 'active',
    }));
  const wrongScope = await deleteStandeeCascade(String(standeeId), { userId: String(otherUser._id) });
  report('2a. cross-user delete rejected (404)', wrongScope.ok === false && wrongScope.status === 404);
  report('2b. standee survives rejected delete', (await Standee.findById(standeeId)) != null);

  /* ═══ 3. Cascade delete detaches assignment + resets flag ═══ */
  const deleted = await deleteStandeeCascade(String(standeeId), { userId: String(user._id) });
  report('3a. scoped cascade delete ok', deleted.ok === true && deleted.remainingStandees === 0, JSON.stringify(deleted));
  report('3b. standee removed', (await Standee.findById(standeeId)) == null);

  const linked = await UserProduct.findOne({ userId: user._id }).sort({ createdAt: -1 });
  report('3c. linked UserProduct standeeId detached', linked?.standeeId == null, `standeeId=${linked?.standeeId}`);
  report('3d. linked UserProduct retired', linked?.status === 'removed', `status=${linked?.status}`);

  const after = await User.findById(user._id);
  report('3e. user.hasStandy = false', after?.hasStandy === false, `hasStandy=${after?.hasStandy}`);
  report('3f. standee_multi_profile capability revoked', (await hasCapability(user._id, 'standee_multi_profile')) === false);

  /* ═══ 4. Multiple standees: flag stays until the last one goes ═══ */
  // Fresh user doc — the previous cascade mutated the DB behind this handle.
  user = (await User.findById(user._id))!;
  const a = await assignUserProduct({ user, catalogItem: cat, quantity: 1, assignedBy: String(user._id) });
  const b = await assignUserProduct({ user, catalogItem: cat, quantity: 1, assignedBy: String(user._id) });
  report('4a. two standees created', a.ok && b.ok);
  if (a.ok && b.ok) {
    const first = await deleteStandeeCascade(String(a.data.standee!._id));
    report('4b. global delete counts remaining standee', first.ok === true && first.remainingStandees === 1, JSON.stringify(first));
    const mid = await User.findById(user._id);
    report('4c. hasStandy stays true while one remains', mid?.hasStandy === true, `hasStandy=${mid?.hasStandy}`);
    const second = await deleteStandeeCascade(String(b.data.standee!._id));
    report('4d. second delete clears remaining', second.ok === true && second.remainingStandees === 0);
    const end = await User.findById(user._id);
    report('4e. hasStandy false after last standee', end?.hasStandy === false, `hasStandy=${end?.hasStandy}`);
  }

  /* ═══ 5. Unknown / malformed id handling ═══ */
  const missing = await deleteStandeeCascade(String(new mongoose.Types.ObjectId()));
  report('5a. unknown id → 404', missing.ok === false && missing.status === 404);

  await cleanup(user._id);
  await mongoose.disconnect();

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Verify run crashed:', error);
  process.exit(2);
});
