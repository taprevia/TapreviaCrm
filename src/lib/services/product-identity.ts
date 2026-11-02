import { isProductId, type ProductId } from '@/config/products';

/**
 * Read-time canonicalization of legacy CatalogProduct slugs.
 *
 * The canonical Premium catalog slug is `premium-nfc-card`. Some historical
 * records use the human public path `premium-card` as their catalog slug.
 * Capability/entitlement resolution must recognize that stable legacy identity
 * without rewriting customer data. Display names are intentionally NOT used as
 * a capability shortcut.
 */
const LEGACY_PRODUCT_SLUGS: Readonly<Record<string, ProductId>> = {
  'premium-card': 'PREMIUM_NFC_CARD',
};

export function resolveCanonicalProductId(slug: string | null | undefined): ProductId | null {
  const normalized = String(slug ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;

  const candidate = normalized.toUpperCase().replace(/-/g, '_');
  if (isProductId(candidate)) return candidate;

  return LEGACY_PRODUCT_SLUGS[normalized] ?? null;
}
