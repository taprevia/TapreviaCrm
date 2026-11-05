import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import AnalyticsLog from '@/models/AnalyticsLog';
import { z } from 'zod';
import { check } from '@/lib/rate-limit';
import { withPublicCardVisibility } from '@/lib/services/card-access';
import {
  isCardOwnerPubliclyVisible,
  isStandeeOwnerPubliclyVisible,
} from '@/lib/services/public-owner-visibility';
import { ok, rateLimitFailure } from '@/lib/api';

export const dynamic = 'force-dynamic';

const trackSchema = z.object({
  alias: z.string().max(40).optional(),
  cardUid: z.string().max(32).optional(),
  action: z.enum([
    'tap',
    'vcard_download',
    'link_click',
    'form_submit',
    'exchange',
    'product_enquiry',
    'share',
    'social_redirect',
    'review_page_view',
    'review_started',
    'review_copied',
    'review_google_clicked',
    'review_suggestions_shown',
    'review_template_used',
  ]),
  metadata: z.string().max(200).optional(),
});

// POST /api/public/track
export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const limit = await check(`track:${ip}`, 120, 60_000);
    const limited = rateLimitFailure(limit, 'Too many tracking requests');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = trackSchema.safeParse(body);
    if (!parsed.success) return ok({ skipped: true });

    const alias = parsed.data.alias;
    const cardUid = parsed.data.cardUid;

    await connectDB();

    const resolveTarget = async (): Promise<{ cardId: string | null; standeeId: string | null } | null> => {
      if (alias) {
        const doc = await Card.findOne(
          withPublicCardVisibility({ urlAlias: alias.toLowerCase() })
        )
          .select('_id userId assignedUserId')
          .lean<{ _id: unknown; userId?: unknown; assignedUserId?: unknown } | null>();
        if (doc) {
          if (!(await isCardOwnerPubliclyVisible(doc))) return null;
          return { cardId: String(doc._id), standeeId: null };
        }

        // Phase 4D.7: Standee public hosts use the same client tracker with
        // their opaque routeSlug/uid. Card resolution wins first, preserving
        // every existing Card analytics contract.
        const standee = await Standee.findOne({
          $or: [
            { $expr: { $eq: [{ $toLower: '$routeSlug' }, alias.toLowerCase()] } },
            { uid: alias.toLowerCase() },
          ],
        })
          .select('_id userId')
          .lean<{ _id: unknown; userId?: unknown } | null>();
        if (standee && !(await isStandeeOwnerPubliclyVisible(standee.userId))) return null;
        return standee ? { cardId: null, standeeId: String(standee._id) } : null;
      }
      if (cardUid) {
        const card = await Card.findOne(
          withPublicCardVisibility({ cardUid: cardUid.toUpperCase() })
        )
          .select('_id userId assignedUserId')
          .lean<{ _id: unknown; userId?: unknown; assignedUserId?: unknown } | null>();
        if (!card || !(await isCardOwnerPubliclyVisible(card))) return null;
        return { cardId: String(card._id), standeeId: null };
      }
      return null;
    };

    const target = await resolveTarget();
    if (!target) return ok({ skipped: true });

    // Aggregate cap per card prevents distributed IP rotation from generating
    // unbounded tap counter and analytics writes.
    if (parsed.data.action === 'tap' && target.cardId) {
      const cardLimit = await check(`track-tap-card:${target.cardId}`, 600, 60_000);
      const limited = rateLimitFailure(cardLimit, 'Card tracking is temporarily busy');
      if (limited) return limited;
    }

    if (parsed.data.action === 'tap' && target.cardId) {
      await Card.updateOne({ _id: target.cardId }, { $inc: { 'stats.taps': 1 } });
    }

    await AnalyticsLog.create({
      cardId: target.cardId,
      ...(target.standeeId ? { standeeId: target.standeeId } : {}),
      action: parsed.data.action,
      metadata: parsed.data.metadata ?? '',
      ip,
      userAgent: request.headers.get('user-agent') ?? '',
    });

    return ok({ recorded: true }, 202);
  } catch (error) {
    console.error('Track POST error:', error);
    return ok({ skipped: true });
  }
}
