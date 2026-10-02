import { z } from 'zod';

export const MAX_PRODUCT_TITLE_LENGTH = 120;

/**
 * Normalize a raw title string: strip control characters, collapse internal
 * whitespace, trim, and cap at the title length limit without ever splitting
 * a surrogate pair (multi-byte characters survive truncation intact).
 */
export function sanitizeProductTitle(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Truncate by code points so a multi-byte char at the boundary is never
  // sliced in half.
  if ([...cleaned].length <= MAX_PRODUCT_TITLE_LENGTH) return cleaned;
  return [...cleaned].slice(0, MAX_PRODUCT_TITLE_LENGTH).join('');
}

/**
 * Customer-facing rename payload. Both `title` (canonical) and `name` (alias)
 * are accepted for callers that historically used `name`. An empty string is
 * allowed — the handler treats it as a reset to the catalog template name.
 * The raw input is allowed to exceed the title limit; sanitization truncates
 * it rather than rejecting borderline-but-valid input.
 */
export const renameProductTitleInputSchema = z
  .object({
    title: z.string().max(MAX_PRODUCT_TITLE_LENGTH * 4).optional(),
    name: z.string().max(MAX_PRODUCT_TITLE_LENGTH * 4).optional(),
  })
  .refine((d) => d.title !== undefined || d.name !== undefined, {
    message: 'Provide a title or name',
  });

export type RenameProductTitleInput = z.infer<typeof renameProductTitleInputSchema>;