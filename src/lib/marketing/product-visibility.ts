import type { Product } from '@/types/marketing';

/**
 * Customer-facing product visibility.
 *
 * PVC is a physical material/variant in this codebase, not a standalone
 * product. This guard exists so that if a PVC-named product is ever present in
 * the marketing catalog (legacy data or a future entry), it is excluded from
 * every customer discovery surface centrally. It never filters material
 * metadata or existing customer assignments.
 *
 * Admin/historical catalog data and purchased products are intentionally not
 * filtered here.
 */
export const HIDDEN_PVC_PRODUCT_IDS = new Set([
  'pvc',
  'pvc-card',
  'pvc-nfc-card',
  'pvc-business-card',
  'pvc-nfc-business-card',
]);

// Legacy fallback for PVC-named rows whose id/slug is not one of the exact
// aliases. Deliberately excludes "PVC-Free"/"PVC free" products and never
// inspects material metadata.
const HIDDEN_PRODUCT_NAME = /^pvc(?:\s|$|-)(?!free\b)/i;

export interface ProductVisibilityIdentity {
  /** Canonical product id, when the surface has one (marketing catalog). */
  id?: string;
  /** Database catalog slug, when the surface reads CatalogProduct rows. */
  slug?: string;
  name?: string;
}

/**
 * Central presentation rule: a PVC-named product is never offered for new
 * discovery/assignment. It remains readable everywhere historical records are
 * rendered (assignments, invoices, support screens).
 */
export function isHiddenPvcProduct(product: ProductVisibilityIdentity): boolean {
  const identifiers = [product.id, product.slug]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (identifiers.some((identifier) => HIDDEN_PVC_PRODUCT_IDS.has(identifier))) {
    return true;
  }
  return HIDDEN_PRODUCT_NAME.test(String(product.name ?? '').trim());
}

export function isCustomerVisibleProduct(product: Pick<Product, 'id' | 'name'>): boolean {
  const id = String(product.id ?? '').trim();
  const name = String(product.name ?? '').trim();
  if (!id && !name) return false;
  return !isHiddenPvcProduct({ id, name });
}

export function filterCustomerVisibleProducts(products: Product[]): Product[] {
  return products.filter(isCustomerVisibleProduct);
}
