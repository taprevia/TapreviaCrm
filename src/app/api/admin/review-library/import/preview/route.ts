import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { reviewLibraryImportSchema } from '@/lib/validation/review-library';
import { analyzeReviewImport } from '@/lib/services/review-library-import';

export const dynamic = 'force-dynamic';

/** POST /api/admin/review-library/import/preview — read-only import analysis. */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const body = await request.json().catch(() => null);
    const parsed = reviewLibraryImportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid import payload', parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.categories.length === 0 && parsed.data.templates.length === 0) {
      return fail(400, 'VALIDATION_ERROR', 'No categories or templates to preview');
    }

    const overwrite = (body as { overwrite?: unknown } | null)?.overwrite === true;
    await connectDB();
    const analysis = await analyzeReviewImport(parsed.data, { overwrite });
    return ok({ preview: analysis });
  } catch (error) {
    console.error('Admin review-library import preview error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Preview failed');
  }
}
