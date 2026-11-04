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
  uid?: string | null;
  publicSlug?: string | null;
  urlAlias?: string | null;
  slug?: string | null;
}

/**
 * Strict Permanent path: ONLY the verified `/r` resolver identifier.
 * `uid` is a supported `/r` identifier (r/[...slug] dual-track lookup).
 * Returns null when no permanent identity exists — never falls back to a
 * Public or legacy path.
 */
export function strictPermanentCardPath(card: PublicCardRoute): string | null {
  const route = (card.routeSlug ?? card.uid ?? '').trim();
  return route ? `/r/${encodeURIComponent(route)}` : null;
}

/** Strict Permanent URL (trusted base + `/r/{routeSlug|uid}`), or null. */
export function strictPermanentCardUrl(
  card: PublicCardRoute,
  publicBaseUrl: string
): string | null {
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const path = strictPermanentCardPath(card);
  if (!base || !path) return null;
  return `${base}${path}`;
}

/**
 * Explicitly labelled Legacy path for cards without a permanent identifier.
 * Preserves the established `/c/{slug}` shim (never presented as Permanent).
 */
export function legacyCardPath(card: PublicCardRoute): string | null {
  const slug = (card.slug ?? '').trim();
  if (slug) return `/c/${encodeURIComponent(slug)}`;
  const alias = (card.urlAlias ?? '').trim();
  if (alias) return `/profile/${encodeURIComponent(alias)}`;
  return null;
}

export function legacyCardUrl(card: PublicCardRoute, publicBaseUrl: string): string | null {
  const base = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const path = legacyCardPath(card);
  if (!base || !path) return null;
  return `${base}${path}`;
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
 * Stable QR fallback used by the customer vCards surface (PPL-01):
 * `/r/{routeSlug}` → `/{publicSlug}` → `/profile/{alias}` → `/c/{slug}`.
 * This is NOT the strict Admin Permanent resolver; use
 * `strictPermanentCardUrl()` for anything labelled Permanent.
 * Returns '' (never an arbitrary URL) when no stable path exists.
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
