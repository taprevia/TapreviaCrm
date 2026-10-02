/**
 * backfill-public-slugs.ts — assign human-readable public URLs
 * ("{business-slug}/{product-slug}[-N]") to existing assigned, active cards.
 *
 * Idempotent and additive only:
 *  - Cards that already carry a publicSlug are never touched.
 *  - No existing field (cardUid, slug, routeSlug, urlAlias, name, company, …)
 *    is rewritten — the public slug is a derived snapshot stored separately.
 *  - Skipping one card never blocks the others (allocation errors are logged).
 *
 * Run with:
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/backfill-public-slugs.ts
 *
 * Optional: pass --dry-run to report what would be assigned without writing.
 */

import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import { ensureCardPublicSlug } from '@/lib/services/human-url';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDB();

  const assignments = (await UserProduct.find({ cardId: { $ne: null } })
    .sort({ createdAt: 1 })
    .select('cardId userId')
    .lean()) as unknown as Array<{ cardId: unknown; userId: unknown }>;

  const seenCards = new Set<string>();
  let assigned = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;

  for (const assignment of assignments) {
    if (!assignment.cardId || !assignment.userId) continue;
    const cardId = String(assignment.cardId);
    if (seenCards.has(cardId)) continue; // one publicSlug per Card record
    seenCards.add(cardId);

    const card = await Card.findById(cardId).select('publicSlug isActive');
    if (!card || !card.isActive) {
      // Retained/unbound or suspended cards stay offline — no public URL claimed.
      if (card) skipped += 1;
      continue;
    }

    if (card.publicSlug) {
      already += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  WOULD assign card ${cardId}`);
      assigned += 1;
      continue;
    }

    try {
      const result = await ensureCardPublicSlug(cardId, String(assignment.userId));
      if (result.assigned && result.publicSlug) {
        assigned += 1;
        console.log(`  assigned ${result.publicSlug} (card ${cardId})`);
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`  FAILED card ${cardId}:`, error instanceof Error ? error.message : error);
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