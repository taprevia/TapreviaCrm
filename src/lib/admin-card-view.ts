/**
 * Pure helpers for the Admin User Details NFC section.
 *
 * Kept outside the page so the 0/1/3/4/5/10-card states and public QR URL
 * construction can be unit tested without a running Next.js server.
 */
import {
  classifyStandeeProfile,
  resolveStandeeEntryDecision,
} from '@/lib/services/standee-entry-state';

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

/**
 * Branded software-QR path for a Card: the permanent publicSlug is preferred.
 * `/r/{routeSlug}` and legacy `/c|/profile` remain fallbacks only when no
 * publicSlug is available. Printed QR/routing helpers above are unchanged.
 */
export function brandedCardQrPath(card: PublicCardRoute): string {
  const publicSlug = (card.publicSlug ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (publicSlug) return `/${publicSlug}`;
  return strictPermanentCardPath(card) ?? legacyCardPath(card) ?? '';
}

export function brandedCardQrUrl(card: PublicCardRoute, publicBaseUrl: string): string {
  const base = trustedBase(publicBaseUrl);
  const path = brandedCardQrPath(card);
  if (!base || !path) return '';
  return `${base}${path}`;
}

export function brandedCardQrIsLegacy(card: PublicCardRoute): boolean {
  return (
    !(card.publicSlug ?? '').trim() &&
    !strictPermanentCardPath(card) &&
    Boolean(legacyCardPath(card))
  );
}

export interface PublicStandeeRoute {
  routeSlug?: string | null;
  uid?: string | null;
  publicSlug?: string | null;
  maxProfiles?: number | null;
  fixedProfiles?: string[] | null;
  socialQrs?: Array<{
    platform?: string | null;
    destinationUrl?: string | null;
  }> | null;
  panelQr?: { qrId?: string | null } | null;
  socialLinks?: Array<{ platform?: string | null; url?: string | null }> | null;
}

function trustedBase(publicBaseUrl: string): string {
  const base = (publicBaseUrl ?? '').trim();
  if (!base) return '';
  try {
    const url = new URL(base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/**
 * Standee panel QR URL.
 *
 * The branded publicSlug is used for:
 *   - modern multi-profile pickers
 *   - legacy AIO pickers (Total Visits counts the picker directly)
 *   - single-profile Standees with a safe external destination
 *
 * Unconfigured, ambiguous, unsafe/same-origin and missing-destination records
 * keep their existing `/r/{routeSlug}` or legacy `/qr/{panelQrId}` fallback so
 * the QR cannot silently change their destination. Slot/social QRs never use
 * this helper.
 */
export function brandedStandeePanelQrUrl(
  standee: PublicStandeeRoute,
  publicBaseUrl: string,
  socialLinks: Array<{ platform?: string | null; url?: string | null }> = []
): string {
  const base = trustedBase(publicBaseUrl);
  if (!base) return '';

  const publicSlug = (standee.publicSlug ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (publicSlug) {
    const profileClass = classifyStandeeProfile(standee);
    const decision = resolveStandeeEntryDecision({
      routeSlug: standee.routeSlug,
      uid: standee.uid,
      maxProfiles: standee.maxProfiles,
      fixedProfiles: standee.fixedProfiles,
      socialQrs: standee.socialQrs,
      socialLinks,
      origin: base,
    });
    if (
      profileClass === 'modern-multi' ||
      profileClass === 'legacy-multi' ||
      decision.action === 'delegate'
    ) {
      return `${base}/${publicSlug}`;
    }
  }

  const route = (standee.routeSlug ?? standee.uid ?? '').trim();
  if (route) return `${base}/r/${encodeURIComponent(route)}`;
  const panelQrId = (standee.panelQr?.qrId ?? '').trim();
  if (panelQrId) return `${base}/qr/${encodeURIComponent(panelQrId)}`;
  return '';
}
