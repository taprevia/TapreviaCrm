import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import {
  reviewCategoryUpsertSchema,
  reviewTemplateUpsertSchema,
  normalizeCategoryPayload,
  normalizeTemplatePayload,
} from '@/lib/validation/review-library';
import { syncCategoryLanguages } from '@/lib/services/review-templates';

export const dynamic = 'force-dynamic';

/**
 * Admin Review Library API.
 *
 * GET  /api/admin/review-library?categoryKey=…  — categories (with template
 *      counts); when categoryKey is given, also its templates.
 * POST /api/admin/review-library                  — upsert { type: 'category' }
 *      or { type: 'template' }. Editing is add/edit/deactivate only.
 * DELETE /api/admin/review-library/categories/[key]?cascade=true — permanently
 *      remove a category (and, with cascade, its templates). See that route.
 */

// GET /api/admin/review-library
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const search = new URL(request.url).searchParams;
    const categoryKey = search.get('categoryKey')?.trim().toLowerCase() ?? '';

    const categories = (await ReviewCategory.find().sort({ name: 1 }).lean().exec()) as unknown as
      Array<{ _id: unknown; key: string }>;

    const counts = await ReviewTemplate.aggregate([
      { $group: { _id: '$categoryKey', count: { $sum: 1 } } },
    ]);

    const countByKey = new Map(
      counts.map((c) => [String(c._id), Number(c.count ?? 0)])
    );

    const serialized = categories.map((c) => ({
      ...c,
      templateCount: countByKey.get(String(c.key)) ?? 0,
    }));

    if (!categoryKey) {
      return ok({ categories: serialized, templates: [] });
    }

    const templates = (await ReviewTemplate.find({ categoryKey })
      .sort({ language: 1, length: 1, createdAt: 1 })
      .lean()
      .exec()) as unknown as unknown[];

    return ok({ categories: serialized, templates });
  } catch (error) {
    console.error('Admin review-library GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// POST /api/admin/review-library
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const body = await request.json().catch(() => null);
    const type = (body as { type?: unknown } | null)?.type;

    await connectDB();

    if (type === 'category') {
      const parsed = reviewCategoryUpsertSchema.safeParse((body as Record<string, unknown>)?.payload);
      if (!parsed.success) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid category', parsed.error.flatten().fieldErrors);
      }
      const saved = await ReviewCategory.findOneAndUpdate(
        { key: parsed.data.key },
        { $set: normalizeCategoryPayload(parsed.data) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return ok({ category: saved });
    }

    if (type === 'template') {
      const parsed = reviewTemplateUpsertSchema.safeParse((body as Record<string, unknown>)?.payload);
      if (!parsed.success) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid template', parsed.error.flatten().fieldErrors);
      }

      const category = await ReviewCategory.findOne({ key: parsed.data.categoryKey }).lean();
      if (!category) {
        return fail(400, 'VALIDATION_ERROR', 'Category not found for this template');
      }
      const scenarioKeys = new Set(
        ((category as { scenarios?: Array<{ key: string }> }).scenarios ?? []).map((s) => s.key)
      );
      if (!scenarioKeys.has(parsed.data.scenario)) {
        return fail(
          400,
          'VALIDATION_ERROR',
          `Scenario "${parsed.data.scenario}" does not exist in this category`
        );
      }

      const saved = await ReviewTemplate.findOneAndUpdate(
        { key: parsed.data.key },
        { $set: normalizeTemplatePayload(parsed.data) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      // Keep the category's `languages` in sync with its active templates —
      // best-effort inside the helper.
      await syncCategoryLanguages([parsed.data.categoryKey]);
      return ok({ template: saved });
    }

    return fail(400, 'VALIDATION_ERROR', `type must be "category" or "template"`);
  } catch (error) {
    console.error('Admin review-library POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}