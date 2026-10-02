import { z } from 'zod';
import {
  ALLOWED_PLACEHOLDERS,
  extractPlaceholders,
  isMarkupFreeText,
} from '@/lib/services/review-templates';
import { reviewPreferredLengthSchema, reviewWritingStyleSchema } from '@/lib/validation/card';

// ─── Primitives ──────────────────────────────────────────────────────────────

export const reviewCategoryKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Category key is too short')
  .max(60, 'Category key is too long')
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, digits, hyphens');

const reviewTagSchema = z.string().trim().min(1).max(60);

const reviewLanguageSchema = z.string().trim().min(1).max(40);

const reviewScenarioSchema = z.object({
  key: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
});

// ─── Upserts ─────────────────────────────────────────────────────────────────

export const reviewCategoryUpsertSchema = z.object({
  key: reviewCategoryKeySchema,
  name: z.string().trim().min(1, 'Category name is required').max(120),
  active: z.boolean().optional(),
  languages: z.array(reviewLanguageSchema).min(1).max(20).optional(),
  scenarios: z.array(reviewScenarioSchema).max(50).optional(),
});

export const reviewTemplateUpsertSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    categoryKey: reviewCategoryKeySchema,
    scenario: z.string().trim().min(1).max(60),
    language: reviewLanguageSchema,
    text: z
      .string()
      .trim()
      .min(1, 'Template text is required')
      .max(1000, 'Template text is too long')
      .refine(isMarkupFreeText, 'Template text must not contain markup (< > &)'),
    length: reviewPreferredLengthSchema,
    style: reviewWritingStyleSchema.optional(),
    compatibleKeywords: z.array(reviewTagSchema).max(12).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (t) => extractPlaceholders(t.text).every((p) => ALLOWED_PLACEHOLDERS.has(p)),
    {
      message:
        'Templates may only use {businessName}, {employee}, {service}, {keyword} placeholders',
      path: ['text'],
    }
  );

// ─── Bulk import ─────────────────────────────────────────────────────────────

export const reviewLibraryImportSchema = z.object({
  categories: z.array(reviewCategoryUpsertSchema).max(200).default([]),
  templates: z.array(reviewTemplateUpsertSchema).max(2000).default([]),
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReviewCategoryUpsertInput = z.infer<typeof reviewCategoryUpsertSchema>;
export type ReviewTemplateUpsertInput = z.infer<typeof reviewTemplateUpsertSchema>;
export type ReviewLibraryImportInput = z.infer<typeof reviewLibraryImportSchema>;

// ─── Shared runtime helpers ──────────────────────────────────────────────────

/** Derived placeholder list for a template — stored on the doc at save. */
export function deriveTemplateVariables(text: string): string[] {
  return extractPlaceholders(text);
}

export type ReviewCategoryPayload = ReviewCategoryUpsertInput;

export type ReviewTemplatePayload = Omit<ReviewTemplateUpsertInput, 'text' | 'language'> & {
  text: string;
  language: string;
  variables: string[];
};

export function normalizeCategoryPayload(input: ReviewCategoryUpsertInput): ReviewCategoryPayload {
  return {
    key: input.key,
    name: input.name,
    active: input.active ?? true,
    languages: input.languages?.length ? input.languages : ['English'],
    scenarios: input.scenarios ?? [],
  };
}

export function normalizeTemplatePayload(input: ReviewTemplateUpsertInput): ReviewTemplatePayload {
  return {
    key: input.key,
    categoryKey: input.categoryKey,
    scenario: input.scenario,
    language: input.language?.trim() || 'English',
    text: input.text,
    length: input.length,
    style: input.style || 'friendly',
    compatibleKeywords: input.compatibleKeywords ?? [],
    active: input.active ?? true,
    variables: deriveTemplateVariables(input.text),
  };
}