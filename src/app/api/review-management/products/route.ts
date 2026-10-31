import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { listEligibleReviewProducts } from '@/lib/services/review-product-eligibility';

export const dynamic = 'force-dynamic';

/** GET /api/review-management/products — read-only connected product list. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiEntitlement(request, 'review_ai_suggestions');
    if (auth.status === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (auth.status === 403) {
      return fail(403, 'FORBIDDEN', 'Review Management is not included in your products');
    }

    await connectDB();
    const products = await listEligibleReviewProducts(auth.user._id);
    return ok({ products });
  } catch (error) {
    console.error('Review management products GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
