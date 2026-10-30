/**
 * Admin product totals derived from the same source the Products page renders:
 * the code catalog (`src/config/products.ts`) merged with CatalogProduct rows.
 * A code product with no DB record is shown as active by the listing.
 */
export interface CatalogRecordLike {
  slug: string;
  active?: boolean;
}

export function countCatalogProducts(
  productIds: readonly string[],
  records: CatalogRecordLike[]
): { products: number; activeProducts: number } {
  const bySlug = new Map(
    records.map((record) => [String(record.slug).toLowerCase(), record])
  );
  const match = (id: string) =>
    bySlug.get(id.toLowerCase().replace(/_/g, '-')) ?? bySlug.get(id.toLowerCase());

  return {
    products: productIds.length,
    activeProducts: productIds.filter((id) => match(id)?.active !== false).length,
  };
}
