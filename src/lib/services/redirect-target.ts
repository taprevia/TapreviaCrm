/**
 * Canonical card destination resolver for permanent NFC/QR routes (/r/...).
 *
 * Product-specific rules (verified against Card + existing route handlers):
 *  - Configured `redirectUrl` wins when present (social/redirect products).
 *  - review: the review experience is /review/{urlAlias}; the human publicSlug
 *    page intentionally 404s when the assistant is disabled, so it is never
 *    used as a redirect destination.
 *  - profile: the human publicSlug page is the canonical destination; legacy
 *    cards fall back to /profile/{urlAlias}.
 *  - social without a configured URL keeps the legacy profile fallback.
 *
 * Returns null when no valid destination exists; callers must 404 rather than
 * inventing a fallback.
 */

export type RoutableCard = {
  kind?: string | null;
  redirectUrl?: string | null;
  publicSlug?: string | null;
  urlAlias?: string | null;
  /** Legacy printed `/c/{slug}` identity; profile fallback only. */
  slug?: string | null;
};

const SAFE_EXTERNAL = /^https?:\/\//i;

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function resolveCardDestination(card: RoutableCard): string | null {
  const redirectUrl = clean(card.redirectUrl);
  if (redirectUrl && SAFE_EXTERNAL.test(redirectUrl)) return redirectUrl;

  const publicSlug = clean(card.publicSlug);
  const urlAlias = clean(card.urlAlias);
  const slug = clean(card.slug);
  const kind = clean(card.kind) || 'profile';

  switch (kind) {
    case 'review':
      // getPublicCardByAlias accepts the legacy printed slug as well, so a
      // historical review card without urlAlias keeps a working destination.
      return urlAlias || slug ? `/review/${encodeURIComponent(urlAlias || slug)}` : null;
    case 'profile':
      if (publicSlug) return `/${publicSlug}`;
      if (urlAlias) return `/profile/${encodeURIComponent(urlAlias)}?src=qr`;
      // Legacy printed cards may only carry `slug`; /c/{slug} is the existing
      // public shim and forwards to the profile without rewriting stored data.
      return slug ? `/c/${encodeURIComponent(slug)}` : null;
    case 'social':
      // Without a configured destination a social card has no valid landing
      // page (its human URL dispatches to the same missing redirect), so fail
      // closed instead of redirecting to an unrelated profile.
      return null;
    default:
      return null;
  }
}
