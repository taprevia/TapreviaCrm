/**
 * Pure helpers for the Admin User Details NFC section.
 *
 * Kept outside the page so the 0/1/3/4/5/10-card states and permanent QR URL
 * construction can be unit tested without a running Next.js server.
 */

export const INITIAL_CARD_LIMIT = 4;

/** Cards visible under the current expand/collapse state, preserving order. */
export function visibleAdminCards<T>(cards: readonly T[], showAll: boolean): T[] {
  return showAll ? [...cards] : cards.slice(0, INITIAL_CARD_LIMIT);
}

/** Remaining cards hidden behind "View More" (0 when no control is shown). */
export function remainingCardCount(total: number): number {
  return Math.max(0, total - INITIAL_CARD_LIMIT);
}

/**
 * Permanent NFC-card QR URL: configured public base + existing /r/{routeSlug}.
 * Returns '' (never /c/{slug}) when no permanent route exists.
 */
export function permanentCardUrl(
  card: { routeSlug?: string },
  publicBaseUrl: string
): string {
  const routeSlug = (card.routeSlug ?? '').trim();
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!routeSlug || !base) return '';
  return `${base}/r/${routeSlug}`;
}
