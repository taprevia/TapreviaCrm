/**
 * Single source of truth for the display title of a product assignment.
 *
 * Renames to `Card.cardLabel` / `Standee.displayName` (and the equivalent
 * `pendingConfig` fields) are the ONLY sources that should ever change the
 * title a customer sees. Every render site must resolve through this cascade so
 * a custom name wins and the catalog/base name is only the fallback.
 */
export interface ProductTitleSource {
  instanceType: 'card' | 'standee' | null;
  hasInstance: boolean;
  /** The bound Card instance (title field: cardLabel, fallback name). */
  card?: { cardLabel?: string | null; name?: string | null } | null;
  /** The bound Standee instance (title field: displayName, fallback name). */
  standee?: { displayName?: string | null; name?: string | null } | null;
  /** Uninstantiated assignment config. */
  pending?: { cardLabel?: string | null; displayName?: string | null } | null;
  /** Catalog product name — final fallback for uninstantiated assignments. */
  catalogName?: string | null;
}

export function resolveProductTitle(source: ProductTitleSource): string {
  const {
    instanceType,
    hasInstance,
    card,
    standee,
    pending,
    catalogName,
  } = source;

  if (instanceType === 'card') {
    if (hasInstance && card) {
      const label = (card.cardLabel ?? '').trim();
      if (label) return label;
      const name = (card.name ?? '').trim();
      if (name) return name;
    } else if (pending) {
      const label = (pending.cardLabel ?? '').trim();
      if (label) return label;
    }
  }

  if (instanceType === 'standee') {
    if (hasInstance && standee) {
      const display = (standee.displayName ?? '').trim();
      if (display) return display;
      const name = (standee.name ?? '').trim();
      if (name) return name;
    } else if (pending) {
      const display = (pending.displayName ?? '').trim();
      if (display) return display;
    }
  }

  return (catalogName ?? '').trim() || 'Product';
}