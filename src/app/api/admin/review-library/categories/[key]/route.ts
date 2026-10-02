import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';

export const dynamic = 'force-dynamic';

type Params = { params: { key: string } };

/**
 * DELETE /api/admin/review-library/categories/[key]?cascade=true
 *
 * Permanently removes a category by key. Templates referencing the category
 * block deletion by default — the endpoint answers 409 CONFLICT with the
 * offending count in `details` so the UI can show the blast radius. Pass
 * `?cascade=true` to delete the category AND its templates in the same call.
 *
 * Responses:
 *  200  { success, key, deletedTemplates }
 *  400  missing key
 *  404  category not found
 *  409  category has templates and cascade was not requested
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const key = String(params.key ?? '').trim().toLowerCase();
    if (!key) return fail(400, 'BAD_REQUEST', 'Category key is required');

    const category = (await ReviewCategory.findOne({ key }).lean()) as {
      _id: unknown;
      key?: string;
      name?: string;
    } | null;
    if (!category) return fail(404, 'NOT_FOUND', 'Category not found');

    const cascade =
      String(new URL(request.url).searchParams.get('cascade') ?? '').toLowerCase() === 'true';

    const templateCount = await ReviewTemplate.countDocuments({ categoryKey: key });
    if (templateCount > 0 && !cascade) {
      return fail(409, 'CONFLICT', `Category "${category.name ?? key}" has ${templateCount} template(s). Deactivate it instead, or delete them too with ?cascade=true.`, {
        templateCount,
      });
    }

    const deleted = cascade ? await ReviewTemplate.deleteMany({ categoryKey: key }) : null;
    await ReviewCategory.deleteOne({ _id: category._id });

    return ok({
      success: true,
      key,
      deletedTemplates: deleted?.deletedCount ?? 0,
    });
  } catch (error) {
    console.error('Admin review-library category DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}