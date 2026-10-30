import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import AnalyticsLog from '@/models/AnalyticsLog';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { check } from '@/lib/rate-limit';
import { withPublicCardVisibility } from '@/lib/services/card-access';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

/**
 * Legacy public card URL. Printed NFC cards in the wild point here, so this
 * shim resolves the alias and forwards to /profile/[alias].
 *
 * A tap is recorded server-side (fail-open) before the redirect — QR scans
 * hitting /c/ are counted exactly like NFC taps on /t/, with no client-side JS.
 */
async function recordShimTap(
  cardId: unknown,
  key: string,
  isActiveCard: boolean
): Promise<void> {
  // Only active cards count against analytics; the card still resolves below.
  if (!isActiveCard) return;
  try {
    const hdrs = headers();
    const ip = clientIpFromHeaders(hdrs);
    const ipLimit = await check(`track:${ip}`, 120, 60_000);
    if (!ipLimit.success) return;
    const cardLimit = await check(`track-tap-card:${String(cardId)}`, 600, 60_000);
    if (!cardLimit.success) return;
    await Promise.all([
      Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } }),
      AnalyticsLog.create({
        cardId,
        action: 'tap',
        metadata: `card:${key}`,
        ip,
        userAgent: hdrs.get('user-agent') ?? '',
      }),
    ]);
  } catch (error) {
    // Fail-open: never let telemetry block the visitor's redirect.
    console.error('Card shim tap analytics failed:', error);
  }
}

export default async function LegacyCardPage({ params }: Params) {
  await connectDB();
  const slug = params.slug.toLowerCase();

  const direct = await Card.findOne(
    withPublicCardVisibility({ $or: [{ urlAlias: slug }, { slug }] })
  )
    .select('urlAlias slug status')
    .lean<{ _id: unknown; urlAlias: string; slug: string; status: string } | null>();
  if (direct) {
    await recordShimTap(direct._id, slug, direct.status === 'active');
    redirect(`/profile/${direct.urlAlias || direct.slug}`);
  }

  const card = await Card.findOne(
    withPublicCardVisibility({ cardUid: slug.toUpperCase() })
  )
    .select('urlAlias slug status')
    .lean<{ _id: unknown; urlAlias: string; slug: string; status: string } | null>();
  if (card) {
    await recordShimTap(card._id, slug.toUpperCase(), card.status === 'active');
    redirect(`/profile/${card.urlAlias || card.slug}`);
  }

  notFound();
}
