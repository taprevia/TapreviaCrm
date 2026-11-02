/**
 * Canonical builder active-tab resolver.
 *
 * Rendering must never dereference an undefined tab. The resolver:
 *  - returns the requested tab when it exists;
 *  - maps the removed legacy `review-assistant` key to the current Reviews tab
 *    (or the closest Details tab);
 *  - otherwise falls back to the product-specific first tab;
 *  - returns null only when the product genuinely has no tabs.
 *
 * Pure and client/server safe so it can be unit tested without React.
 */

export interface BuilderTabLike {
  key: string;
}

export function resolveActiveBuilderTab<T extends BuilderTabLike>(
  tabs: readonly T[],
  requestedKey?: string | null
): T | null {
  if (tabs.length === 0) return null;
  const requested = (requestedKey ?? '').trim();
  if (requested) {
    const exact = tabs.find((tab) => tab.key === requested);
    if (exact) return exact;
    if (requested === 'review-assistant') {
      const legacyReplacement =
        tabs.find((tab) => tab.key === 'reviews') ??
        tabs.find((tab) => tab.key === 'basic');
      if (legacyReplacement) return legacyReplacement;
    }
  }
  return tabs[0] ?? null;
}
