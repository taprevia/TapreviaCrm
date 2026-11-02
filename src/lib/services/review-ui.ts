/**
 * Pure product-page review section visibility.
 *
 * The premium/profile review action is shown only when the API's authoritative
 * eligibility result is true AND the resolved Card instance is a profile. It
 * deliberately does not depend on the historical CatalogProduct.kind value,
 * which may be missing or stale on legacy records.
 */
export interface PremiumReviewSectionInput {
  eligible?: boolean | null;
  cardKind?: string | null;
}

export function shouldShowPremiumReviewSection(
  review: PremiumReviewSectionInput | null | undefined
): boolean {
  if (!review?.eligible) return false;
  return (review.cardKind ?? '').trim().toLowerCase() === 'profile';
}
