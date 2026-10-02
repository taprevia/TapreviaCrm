/**
 * backfill-card-display-names.ts — seed `cardLabel` on cards whose management
 * label is empty, from their linked catalog product name.
 *
 * The product renaming feature resolves a card's title through the cascade
 * `Card.cardLabel` → `Card.name` → catalog name. Cards provisioned before the
 * Card Label feature never seeded `cardLabel`, so without this backfill they
 * would display the card owner's personal name (the `card.name` fallback)
 * instead of the purchased product name.
 *
 * Additive only:
 *  - Cards that already carry a (non-empty) cardLabel are never touched.
 *  - Only cards linked to an active user product assignment get seeded (the
 *    catalog name comes from that link).
 *  - Skipping one card never blocks the others.
 *
 * Run with:
 *   npx tsx scripts/backfill-card-display-names.ts
 *
 * Optional: pass --dry-run to report what would be set without writing.
 */

import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();

  const cards = await Card.find({
    $or: [{ cardLabel: { $exists: false } }, { cardLabel: '' }],
  })
    .sort({ createdAt: 1 })
    .lean();

  let assigned = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const card of cards) {
    if (card.cardLabel && card.cardLabel.trim()) {
      already += 1;
      continue;
    }

    const linked = (await UserProduct.findOne({ cardId: card._id })
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
      console.log(`  WOULD set cardLabel of card ${card._id} to "${catalogName}"`);
      assigned += 1;
      continue;
    }

    try {
      await Card.updateOne({ _id: card._id }, { $set: { cardLabel: catalogName } });
      assigned += 1;
      console.log(`  set cardLabel "${catalogName}" (card ${card.slug})`);
    } catch (error) {
      failed += 1;
      console.error(
        `  FAILED card ${card._id}:`,
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