/**
 * Safe literal search helpers.
 *
 * Dashboard search is a literal, case-insensitive "contains" search. User
 * input must never be interpreted as a regular expression. These helpers are
 * pure so they can be tested without a database.
 */

export const MAX_SEARCH_LENGTH = 100;

export type NormalizedSearch =
  | { ok: true; value: string | null }
  | { ok: false; reason: 'too-long' };

/** Trim, collapse internal whitespace, and enforce a bounded length. */
export function normalizeSearchInput(value: string | null | undefined): NormalizedSearch {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { ok: true, value: null };
  if (normalized.length > MAX_SEARCH_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, value: normalized };
}

/** Escape every regular-expression metacharacter. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a case-insensitive literal matcher for a normalized search term. */
export function literalSearchRegExp(value: string): RegExp {
  return new RegExp(escapeRegExp(value), 'i');
}
