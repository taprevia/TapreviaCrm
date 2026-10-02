/**
 * Backfill routeSlug for existing Cards and Standees.
 *
 * Assigns a permanent, unique route slug to every existing product instance
 * that does not yet have one. Idempotent — safe to run multiple times.
 *
 * Run with: npx tsx scripts/backfill-route-slugs.ts
 */

import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { generateQrId } from '@/lib/utils';

async function main(): Promise<void> {
  await connectDB();

  // ─── Cards ──────────────────────────────────────────────────────────────
  const missingCards = await Card.find({
    $or: [{ routeSlug: { $in: [null, '', undefined] } }],
  });

  let cardsUpdated = 0;
  for (const card of missingCards) {
    card.routeSlug = generateQrId(8);
    await card.save();
    cardsUpdated += 1;
    console.log(
      `card ${card.cardUid} (${card.slug}) -> routeSlug=${card.routeSlug}`
    );
  }

  // ─── Standees ───────────────────────────────────────────────────────────
  const missingStandees = await Standee.find({
    $or: [{ routeSlug: { $in: [null, '', undefined] } }],
  });

  let standeesUpdated = 0;
  for (const standee of missingStandees) {
    standee.routeSlug = generateQrId(8);
    await standee.save();
    standeesUpdated += 1;
    console.log(
      `standee ${standee._id} (${standee.name}) -> routeSlug=${standee.routeSlug}`
    );
  }

  console.log(
    `backfill complete: cardsUpdated=${cardsUpdated} standeesUpdated=${standeesUpdated}`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
