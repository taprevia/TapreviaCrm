import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { resolveEntitlement, serializeEntitlement } from '@/lib/services/capability-access';

export const dynamic = 'force-dynamic';

/** GET /api/my/capabilities — the customer's resolved product capabilities. */
export async function GET(request: NextRequest) {
  try {
    const me = await requireAuth(request);
    if (!me) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const entitlement = await resolveEntitlement(me._id);

    return ok(serializeEntitlement(entitlement));
  } catch (error) {
    console.error('My capabilities GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
