import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import ReviewTemplate from '@/models/ReviewTemplate';

type Params = { params: { key: string } };

/** DELETE /api/admin/review-library/templates/[key] — permanent admin delete. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const key = String(params.key ?? '').trim();
    if (!key) return fail(400, 'BAD_REQUEST', 'Template key is required');

    const deleted = await ReviewTemplate.findOneAndDelete({ key }).lean();
    if (!deleted) return fail(404, 'NOT_FOUND', 'Template not found');

    return ok({ success: true, key });
  } catch (error) {
    console.error('Admin review-template DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
