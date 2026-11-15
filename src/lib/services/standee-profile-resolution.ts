/**
 * Business Profile Standee → linked profile Card destination resolver.
 *
 * The Business Profile Standee is the QR-only physical format of the Premium
 * business profile. Its `Standee.cardId` points at a `Card(kind: 'profile')`
 * owned by the same customer. This module is the single place that turns that
 * relationship into a public destination, so the permanent `/r` resolver and
 * the branded `/{business}/{product}` page can never drift.
 *
 * Fail closed: any invalid, foreign, inactive or non-profile Card reference
 * yields `null` and callers render the safe "unavailable" response rather than
 * falling through to an unrelated redirect.
 */

import Card from '@/models/Card';
import {
  resolveCardDestination,
  type RoutableCard,
} from '@/lib/services/redirect-target';
import {
  isCardOwnerPubliclyVisible,
} from '@/lib/services/public-owner-visibility';
import { withPublicCardVisibility } from '@/lib/services/card-access';

export interface BusinessProfileStandeeSource {
  userId?: unknown;
  productKey?: string;
  cardId?: unknown;
}

/**
 * Resolve the public destination for a Business Profile Standee's linked Card.
 *
 * Returns `null` when the standee is not a Business Profile Standee, has no
 * linked Card, or the linked Card is unavailable/foreign/inactive/non-profile.
 */
export async function resolveBusinessProfileStandeeDestination(
  standee: BusinessProfileStandeeSource
): Promise<string | null> {
  // Strict product gate — do not resolve every standee that merely has a cardId.
  if (standee.productKey !== 'BUSINESS_PROFILE_STANDEE') return null;
  if (!standee.cardId) return null;

  const card = (await Card.findOne(
    withPublicCardVisibility({ _id: standee.cardId })
  )
    .select('urlAlias slug publicSlug kind redirectUrl userId assignedUserId')
    .lean()) as (RoutableCard & {
    _id?: unknown;
    userId?: unknown;
    assignedUserId?: unknown;
  }) | null;

  if (!card) return null;

  // The linked Card must belong to the same owner as the Standee.
  const ownerId = card.userId ?? card.assignedUserId;
  if (!ownerId || String(ownerId) !== String(standee.userId)) return null;

  // Only a profile Card can serve the business profile.
  if ((card.kind ?? 'profile') !== 'profile') return null;

  // Suspended owners revoke the public destination immediately.
  if (!(await isCardOwnerPubliclyVisible(card))) return null;

  return resolveCardDestination(card);
}
