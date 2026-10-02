/**
 * Card display helpers — dashboard management surfaces only.
 * The public profile keeps rendering Card.name (and derived identity); the
 * customer-editable cardLabel is purely a management display label.
 */

export interface CardDisplayNameSource {
  cardLabel?: string | null;
  name?: string | null;
}

/**
 * The name shown for a card in customer-facing dashboard surfaces.
 * An empty/whitespace cardLabel always falls back to Card.name so cards are
 * never automatically renamed by the feature (P9-A).
 */
export function resolveCardDisplayName(card: CardDisplayNameSource): string {
  const label = (card.cardLabel ?? '').trim();
  if (label) return label;
  return card.name ?? '';
}