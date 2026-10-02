import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import AnalyticsLog from '@/models/AnalyticsLog';

type Params = { params: { uid: string } };

/**
 * Best-effort server-side tap write — deliberately fail-open so an analytics
 * error can never break the redirect. The log (cardId, ip, userAgent,
 * timestamp) and the denormalized `stats.taps` counter are persisted BEFORE
 * the 302 is returned; there is no client-side JS hop in the tap path.
 */
async function recordTap(
  cardId: unknown,
  rawKey: string,
  request: NextRequest
): Promise<void> {
  try {
    await Promise.all([
      Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } }),
      AnalyticsLog.create({
        cardId,
        action: 'tap',
        metadata: `card:${rawKey}`,
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent') ?? '',
      }),
    ]);
  } catch (error) {
    // Fail-open: never let telemetry block the visitor's redirect.
    console.error('Tap analytics write failed:', error);
  }
}

/**
 * GET /t/[uid] — NFC tap resolver.
 *
 * Resolves by routeSlug (new) or cardUid (legacy), writes the tap log
 * server-side with the full context (timestamp/cardId/userAgent/IP), then
 * 302s to the card's public profile. Unknown/malformed keys redirect to `/`
 * non-informatively (same convention as /c/).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await connectDB();

    let raw = params.uid;
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Malformed percent-encoding falls through as the raw segment — the
      // lookup simply won't match and we redirect home.
    }

    // Try routeSlug first (new permanent identifier), then fall back to cardUid.
    const card = await Card.findOne({
      isActive: true,
      $or: [
        { routeSlug: raw.toLowerCase() },
        { cardUid: raw.toUpperCase() },
      ],
    }).lean<{ _id: unknown; urlAlias: string; slug: string; status: string } | null>();

    if (!card || !(card.urlAlias || card.slug)) {
      return Response.redirect(new URL('/', request.nextUrl.origin).toString(), 302);
    }

    const target = card.urlAlias || card.slug;

    // Tap accounting is intentionally gated on the card lifecycle status:
    // active cards count, suspended/unassigned cards still resolve but do not
    // inflate analytics. The write completes before the redirect below.
    if (card.status === 'active') {
      await recordTap(card._id, raw, request);
    }

    const dest = new URL(
      `/profile/${target}?src=nfc`,
      request.nextUrl.origin
    );
    return Response.redirect(dest.toString(), 302);
  } catch (error) {
    console.error('Tap resolver error:', error);
    return Response.redirect(new URL('/', request.nextUrl.origin).toString(), 302);
  }
}
