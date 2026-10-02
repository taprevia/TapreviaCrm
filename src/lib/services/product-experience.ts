import type { CardKind, CatalogProductKind } from '@/types';

/**
 * Single source of truth for how a CatalogProduct.kind (the core software
 * experience) maps onto the physical asset's digital experience. Derived at
 * assignment time so a product and its allocated Card.kind can never
 * accidentally conflict.
 *
 * `null` means the experience is not compatible with a Card physical asset
 * (it is a Standee) and must not be allocated to a Card.
 */
export const PRODUCT_KIND_TO_CARD_KIND: Readonly<Record<CatalogProductKind, CardKind | null>> = {
  profile: 'profile',
  social: 'social',
  review: 'review',
  standee: null,
};

export function deriveCardKind(productKind: string): CardKind | null {
  return PRODUCT_KIND_TO_CARD_KIND[productKind as CatalogProductKind] ?? null;
}

/** True when the product kind can be fulfilled by a physical Card. */
export function isCardCompatible(productKind: string): boolean {
  return deriveCardKind(productKind) !== null;
}