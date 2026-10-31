import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { getOwnedCard } from '@/lib/services/card-access';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

/**
 * GET /api/cards/[id]/review-entitlement
 *
 * Product-aware read used by the Review Assistant tab so a lower-tier Card
 * cannot appear unlocked merely because the account owns a Premium product.
 * No writes.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    const entitlement = await getCardReviewEntitlement(result.card);
    return ok(entitlement);
  } catch (error) {
    console.error('Card review entitlement GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
