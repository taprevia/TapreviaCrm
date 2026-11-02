import { z } from 'zod';
import { GOOGLE_REVIEW_URL_MESSAGE, isSupportedGoogleReviewUrl } from './google-review-url';

/** Maximum accepted JSON body for Review Management settings writes. */
export const REVIEW_SETTINGS_MAX_BODY_BYTES = 64 * 1024;

const MAX_URL_LENGTH = 2048;
const MAX_WELCOME_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 60;
const MAX_LANGUAGES = 12;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 50;

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Detect prototype-pollution-shaped payloads before handing them to Zod or
 * Mongoose. JSON.parse creates own properties for `__proto__`; rejecting those
 * explicitly keeps the settings/document path predictable.
 */
export function hasDangerousObjectKeys(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousObjectKeys(item, depth + 1));
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousObjectKeys((value as Record<string, unknown>)[key], depth + 1)) {
      return true;
    }
  }
  return false;
}

/** Reuse the same public-destination policy: http(s), no embedded credentials. */
export function isSafeReviewDestination(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const item = value.trim();
    if (!item || out.includes(item)) continue;
    out.push(item);
  }
  return out;
}

const urlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH)
  .refine(
    (value) => value === '' || isSupportedGoogleReviewUrl(value),
    GOOGLE_REVIEW_URL_MESSAGE
  );

const categorySchema = z
  .string()
  .trim()
  .max(MAX_CATEGORY_LENGTH)
  .transform((value) => value.toLowerCase())
  .refine(
    (value) => !value || /^[a-z0-9][a-z0-9-]*$/.test(value),
    'Category key must use lowercase letters, digits and hyphens'
  );

const languageListSchema = z
  .array(z.string().trim().min(1).max(MAX_LANGUAGE_LENGTH))
  .max(MAX_LANGUAGES)
  .transform(dedupeStrings);

const tagListSchema = z
  .array(z.string().trim().max(MAX_TAG_LENGTH))
  .max(MAX_TAGS)
  .transform(dedupeStrings);

const generalPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    googleReviewUrl: urlSchema.optional(),
    welcomeMessage: z.string().trim().max(MAX_WELCOME_LENGTH).optional(),
    businessName: z.string().trim().max(120).optional(),
  })
  .strict();

const contentPatchSchema = z
  .object({
    category: categorySchema.optional(),
    languages: languageListSchema.optional(),
    writingStyle: z.enum(['friendly', 'professional', 'casual', 'simple']).optional(),
    preferredLength: z.enum(['short', 'medium', 'detailed']).optional(),
    styleMode: z.enum(['fixed', 'varied']).optional(),
    lengthMode: z.enum(['fixed', 'varied']).optional(),
    feedbackTopics: tagListSchema.optional(),
    services: tagListSchema.optional(),
    employees: tagListSchema.optional(),
    keywords: tagListSchema.optional(),
  })
  .strict();

export const reviewSettingsPatchSchema = z
  .object({
    general: generalPatchSchema.optional(),
    content: contentPatchSchema.optional(),
    // Additive stale-form protection. Older clients omit it.
    revision: z.union([z.string().trim().max(40), z.number().int().min(0)]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.general && !value.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of general or content is required',
      });
      return;
    }
    if (value.general && Object.keys(value.general).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['general'],
        message: 'general must contain at least one writable field',
      });
    }
    if (value.content && Object.keys(value.content).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content must contain at least one writable field',
      });
    }
  });

export type ReviewSettingsPatchInput = z.infer<typeof reviewSettingsPatchSchema>;

/** Product-level overrides used by the explicit hybrid source. */
export const reviewProductOverridesSchema = z
  .object({
    enabled: z.boolean().optional(),
    googleReviewUrl: urlSchema.optional(),
    welcomeMessage: z.string().trim().max(MAX_WELCOME_LENGTH).optional(),
    category: categorySchema.optional(),
    languages: languageListSchema.optional(),
    writingStyle: z.enum(['friendly', 'professional', 'casual', 'simple']).optional(),
    preferredLength: z.enum(['short', 'medium', 'detailed']).optional(),
    styleMode: z.enum(['fixed', 'varied']).optional(),
    lengthMode: z.enum(['fixed', 'varied']).optional(),
    feedbackTopics: tagListSchema.optional(),
    services: tagListSchema.optional(),
    employees: tagListSchema.optional(),
    keywords: tagListSchema.optional(),
  })
  .strict();

export const reviewProductConnectionSchema = z
  .object({
    source: z.enum(['legacy', 'central', 'hybrid']),
    overrides: reviewProductOverridesSchema.optional(),
    revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source !== 'hybrid' && value.overrides !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overrides'],
        message: 'Overrides are only valid for hybrid settings',
      });
    }
  });

export type ReviewProductConnectionInput = z.infer<typeof reviewProductConnectionSchema>;
export type ReviewProductOverridesInput = z.infer<typeof reviewProductOverridesSchema>;
