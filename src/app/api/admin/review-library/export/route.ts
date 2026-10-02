import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';

export const dynamic = 'force-dynamic';

/**
 * Admin bulk export — full { categories, templates } JSON, symmetric with the
 * import schema so the admin page round-trips the library exactly.
 */

// GET /api/admin/review-library/export
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const [categories, templates] = await Promise.all([
      ReviewCategory.find().sort({ name: 1, key: 1 }).lean().exec(),
      ReviewTemplate.find().sort({ categoryKey: 1, language: 1, length: 1 }).lean().exec(),
    ]);

    return ok({ categories, templates });
  } catch (error) {
    console.error('Admin review-library export GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Export failed');
  }
}