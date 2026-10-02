/**
 * backfill-standee-display-names.ts — seed `displayName` on standees whose
 * public/title label is empty, from their linked catalog product name.
 *
 * The product renaming feature makes `Standee.displayName` the canonical title
 * source (mirroring `Card.cardLabel`). Standees provisioned before seeding wrote
 * `displayName` never — this backfills those empties so the cascade resolves to
 * the purchased product name instead of falling back to `Standee.name`.
 *
 * Additive only:
 *  - Standees that already carry a (non-empty) displayName are never touched.
 *  - The catalog lookup is best-effort: an unlinked standee is skipped silently.
 *  - Skipping one standee never blocks the others.
 *
 * Run with:
 *   npx tsx scripts/backfill-standee-display-names.ts
 *
 * Optional: pass --dry-run to report what would be set without writing.
 */

import { connectDB } from '@/lib/db';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();

  const standees = await Standee.find({
    $or: [{ displayName: { $exists: false } }, { displayName: '' }],
  })
    .sort({ createdAt: 1 })
    .lean();

  let assigned = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const standee of standees) {
    if (!standee.userId) {
      skipped += 1;
      continue;
    }
    if (standee.displayName && standee.displayName.trim()) {
      already += 1;
      continue;
    }

    const linked = (await UserProduct.findOne({ standeeId: standee._id })
      .select('catalogProductId')
      .lean()) as unknown as { catalogProductId?: unknown } | null;
    let catalogName = '';
    if (linked?.catalogProductId) {
      const catalog = (await CatalogProduct.findById(linked.catalogProductId)
        .select('name')
        .lean()) as unknown as { name?: string } | null;
      catalogName = catalog?.name ?? '';
    }
    if (!catalogName) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  WOULD set displayName of standee ${standee._id} to "${catalogName}"`);
      assigned += 1;
      continue;
    }

    try {
      await Standee.updateOne({ _id: standee._id }, { $set: { displayName: catalogName } });
      assigned += 1;
      console.log(`  set displayName "${catalogName}" (standee ${standee.routeSlug})`);
    } catch (error) {
      failed += 1;
      console.error(
        `  FAILED standee ${standee._id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(
    `\nBackfill ${dryRun ? 'dry-run' : 'complete'}: ${assigned} set, ` +
      `${already} already set, ${skipped} skipped (no catalog link), ${failed} failed`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });