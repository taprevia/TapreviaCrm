/**
 * Product-aware Review Assistant entitlement (Phase 4D.4, hardened in 4D.5).
 *
 * Account capability answers "may this business use Review Management?".
 * A Card-level answer must additionally respect the product that owns that
 * specific Card. A Premium account must not unlock a lower-tier Card merely by
 * owning a Premium product.
 *
 * Decision rule:
 * 1. Cards with any UserProduct assignment (active, removed or inactive) are
 *    evaluated strictly by active product capability. A removed assignment
 *    cannot grant access, and a lower-tier assignment cannot inherit an
 *    unrelated account capability.
 * 2. Cards with NO assignment retain a narrow legacy compatibility path:
 *    - `kind === 'review'` Cards are historical review hosts and keep the
 *      account-level capability (Google Review Card/Plate era).
 *    - A non-review Card that is ALREADY enabled is preserved so an existing
 *      customer never loses working access during this security hardening.
 *    - A non-review Card that is not already enabled is denied. This is the
 *      security fix: a Premium account can no longer newly unlock an
 *      unrelated lower-tier profile/social Card.
 *
 * The remaining ambiguity (a zero-assignment, already-enabled profile Card
 * could have been Premium or lower-tier historically) is intentional and
 * documented. It is preserved, not silently revoked; a production audit and
 * explicit approval are required before any stricter revocation.
 */

import UserProduct from '@/models/UserProduct';
import { getProductCapabilities } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { hasCapability } from '@/lib/services/capability-access';

export type ReviewEntitlementSource =
  | 'product'
  | 'legacy-review-host'
  | 'legacy-preserved'
  | 'none';

export interface CardReviewEntitlement {
  entitled: boolean;
  source: ReviewEntitlementSource;
  productId?: string;
}

interface CardLike {
  _id: unknown;
  userId?: unknown;
  assignedUserId?: unknown;
  kind?: string | null;
  reviewAssistant?: { enabled?: unknown } | null;
}

function reviewCapabilityForProductSlug(slug: string | undefined): boolean {
  const productId = resolveCanonicalProductId(slug);
  if (!productId) return false;
  return getProductCapabilities(productId).includes('review_ai_suggestions');
}

export async function getCardReviewEntitlement(
  card: CardLike
): Promise<CardReviewEntitlement> {
  const assignments = (await UserProduct.find({ cardId: card._id })
    .select('status catalogProductId')
    .populate('catalogProductId', 'slug kind category')
    .lean()
    .exec()) as unknown as Array<{
    status?: string;
    catalogProductId?: { slug?: string } | null;
  }>;

  if (assignments.length > 0) {
    for (const assignment of assignments) {
      if (assignment.status !== 'active') continue;
      const slug = assignment.catalogProductId?.slug;
      if (reviewCapabilityForProductSlug(slug)) {
        return {
          entitled: true,
          source: 'product',
          productId: resolveCanonicalProductId(slug) ?? undefined,
        };
      }
    }
    // A Card with only removed/inactive assignments or with lower-tier active
    // assignments must not inherit an unrelated account-level entitlement.
    return { entitled: false, source: 'none' };
  }

  const ownerId = card.userId ?? card.assignedUserId;
  if (!ownerId) return { entitled: false, source: 'none' };
  if (!(await hasCapability(ownerId, 'review_ai_suggestions'))) {
    return { entitled: false, source: 'none' };
  }

  const kind = (card.kind ?? 'profile').trim().toLowerCase();
  if (kind === 'review') {
    return { entitled: true, source: 'legacy-review-host' };
  }

  // Preserve an already-working legacy configuration. This never grants the
  // ability to turn Review Assistant on for an ambiguous lower-tier Card; it
  // only avoids revoking an existing live configuration without approval.
  if (card.reviewAssistant?.enabled === true) {
    return { entitled: true, source: 'legacy-preserved' };
  }

  return { entitled: false, source: 'none' };
}

export async function canUseReviewAssistantForCard(card: CardLike): Promise<boolean> {
  return (await getCardReviewEntitlement(card)).entitled;
}
