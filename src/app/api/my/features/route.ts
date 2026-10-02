import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { resolveFeatureAccess, toPublicFeatures } from '@/lib/services/feature-access';
import { resolveEntitlement, serializeEntitlement } from '@/lib/services/capability-access';

export const dynamic = 'force-dynamic';

/** GET /api/my/features — the customer's resolved product feature access + capabilities. */
export async function GET(request: NextRequest) {
  try {
    const me = await requireAuth(request);
    if (!me) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const [features, entitlement] = await Promise.all([
      resolveFeatureAccess(me._id),
      resolveEntitlement(me._id),
    ]);

    return ok({
      features: toPublicFeatures(features),
      capabilities: serializeEntitlement(entitlement),
    });
  } catch (error) {
    console.error('My features GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}