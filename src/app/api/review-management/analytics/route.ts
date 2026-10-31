import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { getUnifiedReviewAnalytics } from '@/lib/services/review-analytics';

export const dynamic = 'force-dynamic';

const HOST_PATTERN = /^(all|card:[0-9a-fA-F]{24}|standee:[0-9a-fA-F]{24})$/;

/** GET /api/review-management/analytics?range=30d&host=all */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiEntitlement(request, 'review_ai_suggestions');
    if (auth.status === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (auth.status === 403) {
      return fail(403, 'FORBIDDEN', 'Review Management is not included in your products');
    }

    const sp = new URL(request.url).searchParams;
    const range = sp.get('range') ?? '30d';
    if (range !== '7d' && range !== '30d' && range !== '90d') {
      return fail(400, 'VALIDATION_ERROR', 'range must be 7d, 30d or 90d');
    }
    const host = sp.get('host') ?? 'all';
    if (!HOST_PATTERN.test(host)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid product filter');
    }

    const fromRaw = sp.get('from');
    const toRaw = sp.get('to');
    if (fromRaw && Number.isNaN(Date.parse(fromRaw))) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid from date');
    }
    if (toRaw && Number.isNaN(Date.parse(toRaw))) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid to date');
    }
    if (fromRaw && toRaw && Date.parse(fromRaw) > Date.parse(toRaw)) {
      return fail(400, 'VALIDATION_ERROR', 'from must not be after to');
    }

    await connectDB();
    const result = await getUnifiedReviewAnalytics({
      userId: auth.user._id,
      range,
      hostKey: host,
      ...(fromRaw ? { from: new Date(fromRaw) } : {}),
      ...(toRaw ? { to: new Date(toRaw) } : {}),
    });
    if (!result.ok) {
      return fail(
        400,
        'VALIDATION_ERROR',
        result.code === 'INVALID_HOST'
          ? 'The selected product is not available for this business'
          : 'Invalid date range'
      );
    }

    return ok(result.data);
  } catch (error) {
    console.error('Review analytics GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
