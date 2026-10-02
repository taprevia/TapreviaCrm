import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import User from '@/models/User';
import { bindAssignedCard } from '@/lib/services/card-access';

async function main(): Promise<void> {
  await connectDB();

  const cards = await Card.find({ assignedUserId: { $ne: null } });
  let updated = 0;

  for (const card of cards) {
    const ownerId = card.assignedUserId?.toString();
    const user = ownerId
      ? await User.findById(ownerId).select('name').lean<{ name?: string } | null>()
      : null;

    const beforeUrl = card.urlAlias;
    const beforeUserId = card.userId?.toString() ?? null;
    const beforeName = card.name;

    await bindAssignedCard(card, ownerId ?? '', user?.name);

    if (
      beforeUrl !== card.urlAlias ||
      beforeUserId !== card.userId?.toString() ||
      beforeName !== card.name
    ) {
      updated += 1;
      console.log(
        `bound ${card.cardUid} (${card.slug}) -> user ${ownerId} | urlAlias="${card.urlAlias}" name="${card.name}"`
      );
    }
  }

  console.log(`migration complete: scanned=${cards.length} updated=${updated}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});