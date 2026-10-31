import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { getReviewManagementOptions } from '@/lib/services/review-management-options';

export const dynamic = 'force-dynamic';

const MAX_CATEGORY_LENGTH = 60;

/** GET /api/review-management/options?category=... */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiEntitlement(request, 'review_ai_suggestions');
    if (auth.status === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (auth.status === 403) {
      return fail(403, 'FORBIDDEN', 'Review Management is not included in your products');
    }

    const rawCategory = new URL(request.url).searchParams.get('category');
    let category: string | undefined;
    if (rawCategory !== null) {
      const value = rawCategory.trim().toLowerCase();
      if (
        !value ||
        value.length > MAX_CATEGORY_LENGTH ||
        !/^[a-z0-9][a-z0-9-]*$/.test(value)
      ) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid category');
      }
      category = value;
    }

    await connectDB();
    const options = await getReviewManagementOptions(category);
    if (!options) {
      return fail(400, 'VALIDATION_ERROR', 'Category not found or inactive');
    }

    return ok(options);
  } catch (error) {
    console.error('Review management options GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
