import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import AnalyticsLog from '@/models/AnalyticsLog';
import { clientIpFromHeaders } from '@/lib/request-ip';

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
    await Promise.all([
      Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } }),
      AnalyticsLog.create({
        cardId,
        action: 'tap',
        metadata: `card:${key}`,
        ip: clientIpFromHeaders(hdrs),
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

  const direct = await Card.findOne({
    isActive: true,
    $or: [{ urlAlias: slug }, { slug }],
  })
    .select('urlAlias slug status')
    .lean<{ _id: unknown; urlAlias: string; slug: string; status: string } | null>();
  if (direct) {
    await recordShimTap(direct._id, slug, direct.status === 'active');
    redirect(`/profile/${direct.urlAlias || direct.slug}`);
  }

  const card = await Card.findOne({ cardUid: slug.toUpperCase(), isActive: true })
    .select('urlAlias slug status')
    .lean<{ _id: unknown; urlAlias: string; slug: string; status: string } | null>();
  if (card) {
    await recordShimTap(card._id, slug.toUpperCase(), card.status === 'active');
    redirect(`/profile/${card.urlAlias || card.slug}`);
  }

  notFound();
}
