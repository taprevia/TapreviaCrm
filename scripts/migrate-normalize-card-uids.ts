/**
 * Idempotent migration: enforce the normalized (trim + uppercase) cardUid
 * invariant on EXISTING data.
 *
 * The new no-inventory workflow normalizes every UID at write time; this
 * script normalizes what is already stored and reports any case-insensitive
 * duplicate that would result. Duplicates are NEVER auto-merged/deleted — they
 * are listed for manual review (each is a data-integrity violation).
 *
 * Safe to run multiple times. Run with: npm run migrate:cards
 */

import { connectDB } from '@/lib/db';
import Card from '@/models/Card';

async function main(): Promise<void> {
  await connectDB();

  const cards = await Card.find(
    {},
    'cardUid slug routeSlug assignedUserId'
  ).lean<Array<{ _id: unknown; cardUid: string; slug: string; routeSlug: string; assignedUserId: unknown }>>();

  let normalized = 0;
  const nextByUid = new Map<string, typeof cards[number]>();

  for (const card of cards) {
    const canonical = (card.cardUid ?? '').trim().toUpperCase();
    if (card.cardUid !== canonical) {
      await Card.updateOne({ _id: card._id }, { $set: { cardUid: canonical } });
      normalized += 1;
      console.log(`normalized ${card.cardUid} → ${canonical} (card ${card.slug})`);
    }

    if (!canonical) continue;
    const existing = nextByUid.get(canonical);
    if (existing) {
      console.log(
        `✗ DUPLICATE UID: ${canonical} — ${existing.slug} (${existing.assignedUserId ? 'bound' : 'unbound'}) AND ${card.slug} (${card.assignedUserId ? 'bound' : 'unbound'})`
      );
    } else {
      nextByUid.set(canonical, card);
    }
  }

  const dupRecords = cards.filter((c) => {
    const key = (c.cardUid ?? '').trim().toUpperCase();
    const owner = nextByUid.get(key);
    return owner ? owner._id !== c._id : false;
  });

  console.log(
    `\nmigration complete: normalized=${normalized} duplicateUidRecords=${dupRecords.length} (report-only, never auto-merged)`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});