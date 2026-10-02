import { NextRequest } from 'next/server';
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
import { syncCategoryLanguages } from '@/lib/services/review-templates';

export const dynamic = 'force-dynamic';

/**
 * Admin bulk import — upserts a full category + template library from the
 * JSON artifact. Non-destructive (upsert by key only; never deletes existing
 * rows). Per-item failures are aggregated, never partial-write destructive.
 *
 * Optimized for large payloads: categories and templates are each written in
 * a single `bulkWrite` (one round trip per collection instead of one query
 * per row) with a size guard up front so oversized requests fail fast with a
 * structured 413 rather than a dropped connection.
 */

// ─── Payload size guard ──────────────────────────────────────────────────────
// Serverless platforms reject request bodies above their own limits before
// this handler runs; enforcing our own ceiling surfaces a structured error.
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

interface BulkWriteErrorItem {
  index?: number;
  errmsg?: string;
  err?: { message?: string };
}

interface BulkWriteErrorLike {
  writeErrors?: Array<BulkWriteErrorItem>;
}

/**
 * Map `MongoBulkWriteError.writeErrors` back to the payload keys so failures
 * degrade to per-item errors. Returns `{ messages, fatal }`; `fatal` is set
 * when the whole write failed with no attributable write errors.
 */
function extractBulkWriteErrors(
  err: unknown,
  keys: string[],
  kind: 'category' | 'template'
): { messages: string[]; fatal: string | null } {
  const messages: string[] = [];
  const writeErrors = (err as BulkWriteErrorLike | null)?.writeErrors;
  if (Array.isArray(writeErrors)) {
    for (const we of writeErrors) {
      const message = we.err?.message ?? we.errmsg ?? 'write failed';
      const key =
        typeof we.index === 'number' && we.index >= 0 && we.index < keys.length ? keys[we.index] : '?';
      messages.push(`${kind}:${key}: ${message}`);
    }
    return { messages, fatal: null };
  }
  return { messages, fatal: err instanceof Error ? err.message : 'bulk write failed' };
}

// POST /api/admin/review-library/import
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Import payload too large');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Invalid JSON payload');
    }

    const parsed = reviewLibraryImportSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid import payload', parsed.error.flatten().fieldErrors);
    }

    await connectDB();

    const errors: string[] = [];

    // 1. Upsert categories in a single bulkWrite (ordered:false keeps going on errors).
    let categoriesImported = 0;
    const categoryKeys = parsed.data.categories.map((c) => c.key);
    if (categoryKeys.length > 0) {
      try {
        await ReviewCategory.bulkWrite(
          parsed.data.categories.map((category) => ({
            updateOne: {
              filter: { key: category.key },
              update: {
                $set: { ...normalizeCategoryPayload(category), updatedAt: new Date() },
                $setOnInsert: { createdAt: new Date() },
              },
              upsert: true,
            },
          })),
          { ordered: false }
        );
        categoriesImported = parsed.data.categories.length;
      } catch (error) {
        const { messages, fatal } = extractBulkWriteErrors(error, categoryKeys, 'category');
        if (fatal) return fail(500, 'INTERNAL_ERROR', `Category bulk write failed: ${fatal}`);
        errors.push(...messages);
        categoriesImported = parsed.data.categories.length - messages.length;
      }
    }

    // 2. Validate templates against the merged category set (DB as source of
    //    truth) — scenario must exist in the category's scenario list.
    const merged = (await ReviewCategory.find().select('key scenarios').lean().exec()) as unknown as
      Array<{ key: string; scenarios?: Array<{ key: string }> }>;
    const scenarioByCategory = new Map<string, Set<string>>();
    for (const category of merged) {
      scenarioByCategory.set(
        category.key,
        new Set((category.scenarios ?? []).map((s) => s.key))
      );
    }

    // 3. Collect valid template ops (key kept parallel to the op array so
    //    writeError indexes map back to payload keys) and write in one bulkWrite.
    type TemplateBulkOp = Parameters<typeof ReviewTemplate.bulkWrite>[0][number];
    const templateOps: Array<{ key: string; op: TemplateBulkOp }> = [];
    for (const template of parsed.data.templates) {
      const scenarios = scenarioByCategory.get(template.categoryKey);
      if (!scenarios) {
        errors.push(`template:${template.key}: category "${template.categoryKey}" not found`);
        continue;
      }
      if (!scenarios.has(template.scenario)) {
        errors.push(
          `template:${template.key}: scenario "${template.scenario}" does not exist in category`
        );
        continue;
      }
      templateOps.push({
        key: template.key,
        op: {
          updateOne: {
            filter: { key: template.key },
            update: {
              $set: { ...normalizeTemplatePayload(template), updatedAt: new Date() },
              $setOnInsert: { createdAt: new Date(), usageCount: 0, lastShownAt: null },
            },
            upsert: true,
          },
        },
      });
    }

    let templatesImported = templateOps.length;
    if (templateOps.length > 0) {
      try {
        await ReviewTemplate.bulkWrite(
          templateOps.map((t) => t.op),
          { ordered: false }
        );
      } catch (error) {
        const { messages, fatal } = extractBulkWriteErrors(error, templateOps.map((t) => t.key), 'template');
        if (fatal) return fail(500, 'INTERNAL_ERROR', `Template bulk write failed: ${fatal}`);
        errors.push(...messages);
        templatesImported -= messages.length;
      }
    }

    // 4. Keep category `languages` in sync with the distinct languages now on
    //    their active templates — best-effort inside the helper.
    await syncCategoryLanguages([
      ...new Set([
        ...parsed.data.categories.map((c) => c.key),
        ...parsed.data.templates.map((t) => t.categoryKey),
      ]),
    ]);

    return ok({
      imported: { categories: categoriesImported, templates: templatesImported },
      errors,
    });
  } catch (error) {
    console.error('Admin review-library import POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Import failed');
  }
}