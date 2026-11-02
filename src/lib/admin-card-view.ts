/**
 * Pure helpers for the Admin User Details NFC section.
 *
 * Kept outside the page so the 0/1/3/4/5/10-card states and public QR URL
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

export interface PublicCardRoute {
  routeSlug?: string | null;
  publicSlug?: string | null;
  urlAlias?: string | null;
  slug?: string | null;
}

/**
 * Best stable public path for a Card, in compatibility order:
 *   1. `/r/{routeSlug}` — permanent NFC/QR route (preferred).
 *   2. `/{publicSlug}` — human business/product URL.
 *   3. `/profile/{urlAlias}` — legacy public profile.
 *   4. `/c/{slug}` — legacy printed card URL shim.
 *
 * Returns '' when the card has no usable public identity. This never invents
 * an identifier or rewrites a stored one.
 */
export function cardPublicQrPath(card: PublicCardRoute): string {
  const routeSlug = (card.routeSlug ?? '').trim();
  if (routeSlug) return `/r/${routeSlug}`;
  const publicSlug = (card.publicSlug ?? '').trim().replace(/^\/+/, '');
  if (publicSlug) return `/${publicSlug}`;
  const urlAlias = (card.urlAlias ?? '').trim();
  if (urlAlias) return `/profile/${urlAlias}`;
  const slug = (card.slug ?? '').trim();
  if (slug) return `/c/${slug}`;
  return '';
}

/**
 * Permanent NFC-card QR URL: configured public base + the best stable public
 * path. Returns '' (never an arbitrary URL) when no public route exists.
 */
export function permanentCardUrl(
  card: PublicCardRoute,
  publicBaseUrl: string
): string {
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const path = cardPublicQrPath(card);
  if (!base || !path) return '';
  return `${base}${path}`;
}
