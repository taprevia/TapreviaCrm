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
    const rawMode = (body as { mode?: unknown } | null)?.mode;
    const mode =
      rawMode === 'update' ? 'update' : rawMode === 'create' ? 'create' : 'legacy';

    await connectDB();

    if (type === 'category') {
      const parsed = reviewCategoryUpsertSchema.safeParse((body as Record<string, unknown>)?.payload);
      if (!parsed.success) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid category', parsed.error.flatten().fieldErrors);
      }
      const payload = normalizeCategoryPayload(parsed.data);

      if (mode === 'legacy') {
        const saved = await ReviewCategory.findOneAndUpdate(
          { key: payload.key },
          { $set: payload },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return ok({ category: saved });
      }

      if (mode === 'update') {
        const existing = await ReviewCategory.findOne({ key: payload.key }).lean();
        if (!existing) {
          return fail(404, 'NOT_FOUND', 'Category not found');
        }
        const existingKeys = new Set(
          ((existing as { scenarios?: Array<{ key: string }> }).scenarios ?? []).map((s) => s.key)
        );
        const nextKeys = new Set((payload.scenarios ?? []).map((s) => s.key));
        for (const removedKey of existingKeys) {
          if (nextKeys.has(removedKey)) continue;
          const templateCount = await ReviewTemplate.countDocuments({
            categoryKey: payload.key,
            scenario: removedKey,
          });
          if (templateCount > 0) {
            return fail(
              409,
              'CONFLICT',
              `Scenario "${removedKey}" is still used by ${templateCount} template(s). Reassign or delete them first.`,
              { scenario: removedKey, templateCount }
            );
          }
        }
        const saved = await ReviewCategory.findOneAndUpdate(
          { key: payload.key },
          { $set: payload },
          { new: true, runValidators: true }
        );
        return ok({ category: saved });
      }

      if (await ReviewCategory.exists({ key: payload.key })) {
        return fail(409, 'CONFLICT', `Category key "${payload.key}" already exists.`);
      }
      try {
        const created = await ReviewCategory.create(payload);
        return ok({ category: created }, 201);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          return fail(409, 'CONFLICT', `Category key "${payload.key}" already exists.`);
        }
        throw error;
      }
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

      const templatePayload = normalizeTemplatePayload(parsed.data);
      if (mode === 'legacy') {
        const saved = await ReviewTemplate.findOneAndUpdate(
          { key: templatePayload.key },
          { $set: templatePayload },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        await syncCategoryLanguages([parsed.data.categoryKey]);
        return ok({ template: saved });
      }
      if (mode === 'update') {
        const saved = await ReviewTemplate.findOneAndUpdate(
          { key: templatePayload.key },
          { $set: templatePayload },
          { new: true, runValidators: true }
        );
        if (!saved) return fail(404, 'NOT_FOUND', 'Template not found');
        await syncCategoryLanguages([parsed.data.categoryKey]);
        return ok({ template: saved });
      }
      if (await ReviewTemplate.exists({ key: templatePayload.key })) {
        return fail(409, 'CONFLICT', `Template key "${templatePayload.key}" already exists.`);
      }
      let saved;
      try {
        saved = await ReviewTemplate.create(templatePayload);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          return fail(409, 'CONFLICT', `Template key "${templatePayload.key}" already exists.`);
        }
        throw error;
      }
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