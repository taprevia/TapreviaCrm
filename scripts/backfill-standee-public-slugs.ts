/**
 * backfill-standee-public-slugs.ts — assign human-readable public URLs
 * ("{business-slug}/standee[-N]") to existing user standees.
 *
 * Idempotent and additive only:
 *  - Standees that already carry a publicSlug are never touched.
 *  - No existing field (routeSlug, displayName, productKey, …) is rewritten.
 *  - Skipping one standee never blocks the others (allocation errors are logged).
 *
 * Run with:
 *   npx tsx scripts/backfill-standee-public-slugs.ts
 *
 * Optional: pass --dry-run to report what would be assigned without writing.
 */

import { connectDB } from '@/lib/db';
import Standee from '@/models/Standee';
import { ensureStandeePublicSlug } from '@/lib/services/human-url';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();

  const standees = await Standee.find({}).sort({ createdAt: 1 }).lean();

  let assigned = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const standee of standees) {
    if (!standee.userId) {
      skipped += 1;
      continue;
    }
    if (standee.publicSlug) {
      already += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  WOULD assign standee ${standee._id}`);
      assigned += 1;
      continue;
    }

    try {
      const result = await ensureStandeePublicSlug(
        standee._id,
        String(standee.userId)
      );
      if (result.assigned && result.publicSlug) {
        assigned += 1;
        console.log(`  assigned ${result.publicSlug} (standee ${standee.routeSlug})`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `  FAILED standee ${standee._id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(
    `\nBackfill ${dryRun ? 'dry-run' : 'complete'}: ${assigned} assigned, ` +
      `${already} already set, ${skipped} skipped, ${failed} failed`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });