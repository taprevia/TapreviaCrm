/**
 * Idempotent backfill for P9 identity fields on pre-P9 databases:
 *   1. Assign a permanent Customer ID (CUST-000001 style) to every user that
 *      lacks one (created before the pre-save hook existed).
 *   2. Derive a company profile slug (User.bizSlug) for customers that lack
 *      one — sourced from the same business-identity priority used at runtime
 *      (card company → profile companyName → card name → user name). Existing
 *      slugs are never touched.
 *   3. Seed each bizslug:{base} counter to the count of occupied slugs for that
 *      base, so suffixes freed by pre-P9 deletions are never re-issued to a new
 *      account (permanent-identity semantics).
 *
 * Safe to run repeatedly. Run with: npm run backfill:identity
 * Sequence: must run BEFORE new customers are created post-P9 and BEFORE the
 * integrity invariant "customers missing customerId" can pass.
 */

import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import Counter from '@/models/Counter';
import { assignCustomerId } from '@/lib/services/customer-identity';
import {
  ensureUserBizSlug,
  resolveBusinessNameSource,
} from '@/lib/services/human-url';
import { generateSlug } from '@/lib/utils';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assignCustomerIds(): Promise<number> {
  const cursor = User.find({
    $or: [{ customerId: null }, { customerId: '' }, { customerId: { $exists: false } }],
  }).cursor();
  let count = 0;
  for await (const user of cursor) {
    user.customerId = await assignCustomerId(user);
    await user.save();
    count += 1;
  }
  return count;
}

async function assignCustomerSlugs(): Promise<number> {
  const cursor = User.find({
    role: 'customer',
    $or: [{ bizSlug: null }, { bizSlug: '' }, { bizSlug: { $exists: false } }],
  }).cursor();
  let count = 0;
  for await (const user of cursor) {
    const [profile, card] = await Promise.all([
      Profile.findOne({ userId: user._id })
        .select('companyInfo.companyName')
        .lean()
        .then((doc) =>
          (doc as unknown) as { companyInfo?: { companyName?: string | null } } | null
        ),
      Card.findOne({ $or: [{ userId: user._id }, { assignedUserId: user._id }] })
        .sort({ createdAt: 1 })
        .select('basic.company name')
        .lean()
        .then((doc) =>
          (doc as unknown) as { basic?: { company?: string | null }; name?: string | null } | null
        ),
    ]);
    await ensureUserBizSlug(user, resolveBusinessNameSource({ card, user, profile }));
    count += 1;
  }
  return count;
}

/**
 * Seed `bizslug:{base}` counters to the number of distinct occupied slugs under
 * that base. The counter only ever moves forward, so the NEXT allocation lands
 * beyond every occupied slot; any slot freed by a pre-P9 deletion sits below
 * that and is never offered again. (Collision-retry pushes past slugs whose
 * numbers outrun the count — the unique index is the net.)
 */
async function seedBaseCounters(): Promise<number> {
  const slugs = await User.distinct('bizSlug', { bizSlug: { $ne: null } });
  const bases = new Set(slugs.map((s) => s.replace(/-\d+$/, '')));
  let seeded = 0;
  for (const base of bases) {
    if (!base) continue;
    // Matching slug must be the bare base or base-N (numeric suffix) — exactly
    // the shape the allocator produces (generateSlug-derivable + "-N").
    const matcher = new RegExp(`^${escapeRegExp(base)}(?:-[1-9][0-9]*)?$`);
    const occupied = await User.countDocuments({ bizSlug: matcher });
    if (occupied === 0) continue;
    await Counter.findOneAndUpdate(
      { _id: `bizslug:${base}` },
      { $max: { seq: occupied } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    seeded += 1;
  }
  return seeded;
}

async function main(): Promise<void> {
  await connectDB();

  console.log('═ Backfill customer identities (P9) ═\n');

  const idsAssigned = await assignCustomerIds();
  console.log(`customer ids assigned: ${idsAssigned}`);

  const slugsAssigned = await assignCustomerSlugs();
  console.log(`business slugs derived for customers: ${slugsAssigned}`);

  const countersSeeded = await seedBaseCounters();
  console.log(`bizslug counters seeded: ${countersSeeded}`);

  const stillMissingIds = await User.countDocuments({
    role: 'customer',
    $or: [{ customerId: null }, { customerId: '' }, { customerId: { $exists: false } }],
  });
  console.log(
    `customers still missing customerId: ${stillMissingIds} ${stillMissingIds ? '(run preflight → integrity to confirm the invariant clears)' : '✓'}`
  );

  console.log('\n✓ Backfill complete (idempotent — safe to re-run).');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});