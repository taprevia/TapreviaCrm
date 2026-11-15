import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getOwnedCard } from '@/lib/services/card-access';
import {
  resolveCardSocialMax,
  resolveFeatureAccess,
  toPublicFeatures,
} from '@/lib/services/feature-access';
import { resolveEntitlement, serializeEntitlement } from '@/lib/services/capability-access';

export const dynamic = 'force-dynamic';

/** GET /api/my/features — the customer's resolved product feature access + capabilities. */
export async function GET(request: NextRequest) {
  try {
    const me = await requireAuth(request);
    if (!me) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const cardId = new URL(request.url).searchParams.get('cardId')?.trim();
    const [accountFeatures, entitlement] = await Promise.all([
      resolveFeatureAccess(me._id),
      resolveEntitlement(me._id),
    ]);
    let features = accountFeatures;

    if (cardId) {
      const result = await getOwnedCard(cardId, me);
      if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
      if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

      const cardSocialMax = await resolveCardSocialMax(result.card._id, me._id);
      if (cardSocialMax !== undefined) {
        features = {
          ...accountFeatures,
          social: { ...accountFeatures.social, max: cardSocialMax },
        };
      }
    }

    return ok({
      features: toPublicFeatures(features),
      capabilities: serializeEntitlement(entitlement),
    });
  } catch (error) {
    console.error('My features GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}