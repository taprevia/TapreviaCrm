/**
 * Customer-facing Public URL resolver.
 *
 * Customers share/display the immutable PUBLIC URL; NFC/QR payloads remain the
 * permanent `/r/{routeSlug}` route (PPL-01). Keeping this separate prevents a
 * technical permanent route from leaking into Copy/Share actions.
 *
 * Product-specific public destinations:
 *   - review  → /{publicSlug} → /review/{urlAlias | slug}
 *   - profile → /{publicSlug} → /profile/{urlAlias} → /c/{slug}
 *   - social  → /{publicSlug} (Taprevia route that redirects externally);
 *               never the raw external destination.
 *
 * Returns null when no stable Taprevia public route exists. Callers must show
 * "Public URL unavailable" rather than substituting `/r/{routeSlug}`.
 */

export interface CustomerPublicCardSource {
  kind?: string | null;
  publicSlug?: string | null;
  urlAlias?: string | null;
  slug?: string | null;
}

export interface CustomerPublicStandeeSource {
  publicSlug?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Relative public path, or null when the record has no stable public route. */
export function resolveCustomerPublicPath(
  card: CustomerPublicCardSource | null | undefined
): string | null {
  if (!card) return null;

  const kind = clean(card.kind).toLowerCase() || 'profile';
  const publicSlug = clean(card.publicSlug).replace(/^\/+/, '');
  const alias = clean(card.urlAlias);
  const slug = clean(card.slug);

  if (kind === 'review') {
    // Prefer the already-allocated immutable publicSlug. The public slug route
    // dispatches review cards to the existing /review/{alias} experience, so
    // this is a branding-only change and the alias route stays valid.
    if (publicSlug) return `/${publicSlug}`;
    const reviewKey = alias || slug;
    return reviewKey ? `/review/${encodeURIComponent(reviewKey)}` : null;
  }

  // Human business/product URL is the canonical public identity for profile
  // and social products. It stays a Taprevia URL and redirects per kind.
  if (publicSlug) return `/${publicSlug}`;
  if (alias) return `/profile/${encodeURIComponent(alias)}`;
  // Legacy printed card shim — public, but not the permanent /r route.
  if (slug) return `/c/${encodeURIComponent(slug)}`;
  return null;
}

/** Absolute customer-facing public URL using the trusted configured base. */
export function resolveCustomerPublicUrl(
  card: CustomerPublicCardSource | null | undefined,
  baseUrl: string | null | undefined
): string | null {
  const base = clean(baseUrl).replace(/\/+$/, '');
  const path = resolveCustomerPublicPath(card);
  if (!base || !path) return null;
  return `${base}${path}`;
}

/** Standees share the allocated `/{business}/{standee}[-N]` public path. */
export function resolveCustomerStandeePath(
  standee: CustomerPublicStandeeSource | null | undefined
): string | null {
  const publicSlug = clean(standee?.publicSlug).replace(/^\/+/, '');
  return publicSlug ? `/${publicSlug}` : null;
}

export function resolveCustomerStandeeUrl(
  standee: CustomerPublicStandeeSource | null | undefined,
  baseUrl: string | null | undefined
): string | null {
  const base = clean(baseUrl).replace(/\/+$/, '');
  const path = resolveCustomerStandeePath(standee);
  if (!base || !path) return null;
  return `${base}${path}`;
}
