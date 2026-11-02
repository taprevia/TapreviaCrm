import { NextRequest } from 'next/server';
import mongoose, { type ClientSession } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import {
  reviewLibraryImportSchema,
  normalizeCategoryPayload,
  normalizeTemplatePayload,
} from '@/lib/validation/review-library';
import { analyzeReviewImport } from '@/lib/services/review-library-import';
import { syncCategoryLanguages } from '@/lib/services/review-templates';
import { REVIEW_IMPORT_MAX_BYTES } from '@/lib/review-library-import-payload';

export const dynamic = 'force-dynamic';

/**
 * Admin bulk import — upserts a full category + template library from the
 * JSON artifact. Non-destructive (upsert by key only; never deletes existing
 * rows). The complete payload is validated before any write:
 *
 *  1. zod field validation (styles, lengths, placeholders, duplicate scenarios)
 *  2. duplicate category/template key detection
 *  3. category/scenario relationship checks with overwrite semantics
 *  4. Mongoose model validation for every record
 *
 * Writes then run in a MongoDB transaction when the deployment supports one
 * (Atlas / replica set). Standalone MongoDB is prevalidated the same way and
 * written in ordered bulk operations; a rare database-level write failure can
 * still leave earlier bulk operations committed there, which is reported.
 */

type CategoryBulkOp = Parameters<typeof ReviewCategory.bulkWrite>[0][number];
type TemplateBulkOp = Parameters<typeof ReviewTemplate.bulkWrite>[0][number];

async function supportsTransactions(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  try {
    const hello = (await db.admin().command({ hello: 1 })) as {
      setName?: string;
      msg?: string;
    };
    return Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    return false;
  }
}

// POST /api/admin/review-library/import
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > REVIEW_IMPORT_MAX_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Import payload too large');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Invalid JSON payload');
    }

    const overwrite = (body as { overwrite?: unknown } | null)?.overwrite === true;
    const parsed = reviewLibraryImportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid import payload', parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.categories.length === 0 && parsed.data.templates.length === 0) {
      return fail(400, 'VALIDATION_ERROR', 'No categories or templates to import');
    }

    await connectDB();

    // Read-only analysis: duplicates and category/scenario relationships are
    // evaluated against the same overwrite semantics the writes will use.
    const analysis = await analyzeReviewImport(parsed.data, { overwrite });
    if (analysis.invalid.length > 0) {
      return fail(400, 'VALIDATION_ERROR', 'Import validation failed', {
        invalid: analysis.invalid,
      });
    }

    const existingCategoryKeys = new Set(analysis.existingCategoryKeys);
    const existingTemplateKeys = new Set(analysis.existingTemplateKeys);

    const categoriesToWrite = parsed.data.categories.filter(
      (category) => overwrite || !existingCategoryKeys.has(category.key)
    );
    const categoriesSkipped = parsed.data.categories.length - categoriesToWrite.length;

    const writableTemplates = parsed.data.templates.filter(
      (template) => overwrite || !existingTemplateKeys.has(template.key)
    );
    const templatesSkipped = parsed.data.templates.length - writableTemplates.length;

    // Model-level preflight (max scenarios, text length, enum/default rules).
    // Nothing is written until every record passes.
    const modelErrors: string[] = [];
    for (const category of categoriesToWrite) {
      const error = new ReviewCategory(normalizeCategoryPayload(category)).validateSync();
      if (error) modelErrors.push(`category:${category.key}: ${error.message}`);
    }
    for (const template of writableTemplates) {
      const error = new ReviewTemplate(normalizeTemplatePayload(template)).validateSync();
      if (error) modelErrors.push(`template:${template.key}: ${error.message}`);
    }
    if (modelErrors.length > 0) {
      return fail(400, 'VALIDATION_ERROR', 'Import validation failed', {
        invalid: modelErrors,
      });
    }

    const categoryOps: CategoryBulkOp[] = categoriesToWrite.map((category) => ({
      updateOne: {
        filter: { key: category.key },
        update: {
          $set: { ...normalizeCategoryPayload(category), updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));

    const templateOps: TemplateBulkOp[] = writableTemplates.map((template) => ({
      updateOne: {
        filter: { key: template.key },
        update: {
          $set: { ...normalizeTemplatePayload(template), updatedAt: new Date() },
          $setOnInsert: {
            createdAt: new Date(),
            usageCount: template.usageCount ?? 0,
            lastShownAt: template.lastShownAt ? new Date(template.lastShownAt) : null,
          },
        },
        upsert: true,
      },
    }));

    const writeAll = async (session?: ClientSession) => {
      if (categoryOps.length > 0) {
        await ReviewCategory.bulkWrite(categoryOps, {
          ordered: true,
          ...(session ? { session } : {}),
        });
      }
      if (templateOps.length > 0) {
        await ReviewTemplate.bulkWrite(templateOps, {
          ordered: true,
          ...(session ? { session } : {}),
        });
      }
    };

    const transactional = await supportsTransactions();
    try {
      if (transactional) {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await writeAll(session);
          });
        } finally {
          await session.endSession();
        }
      } else {
        await writeAll();
      }
    } catch (error) {
      console.error('Admin review-library import write error:', error);
      return fail(
        500,
        'INTERNAL_ERROR',
        transactional
          ? 'Import failed; no records were committed.'
          : 'Import failed during write. This local MongoDB is standalone, so earlier bulk operations may have been committed.'
      );
    }

    // Keep category `languages` in sync with the distinct languages now on
    // their active templates — best-effort inside the helper.
    await syncCategoryLanguages([
      ...new Set([
        ...parsed.data.categories.map((category) => category.key),
        ...parsed.data.templates.map((template) => template.categoryKey),
      ]),
    ]);

    return ok({
      imported: { categories: categoriesToWrite.length, templates: writableTemplates.length },
      skipped: { categories: categoriesSkipped, templates: templatesSkipped },
      errors: [],
    });
  } catch (error) {
    console.error('Admin review-library import POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Import failed');
  }
}
