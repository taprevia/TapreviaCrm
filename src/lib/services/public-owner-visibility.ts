/**
 * Canonical public owner-visibility policy.
 *
 * A public Card or Standee is reachable only while the owning User is not
 * suspended. The User model's only lifecycle values are `active` and
 * `suspended`; missing status is treated as legacy-active.
 *
 * The helpers fail closed on unexpected database errors. Card compatibility
 * preserves the existing "ownerless legacy card" behavior: when no owner id is
 * present the Card's existing visibility predicate remains authoritative.
 */
import User from '@/models/User';

interface CardOwnerLike {
  userId?: unknown;
  assignedUserId?: unknown;
}

/**
 * True when every owner reference on the Card is non-suspended.
 *
 * - No owner references: preserve legacy ownerless-card compatibility.
 * - Any suspended owner: deny.
 * - Database error: deny (fail closed).
 */
export async function isCardOwnerPubliclyVisible(
  card: CardOwnerLike | null | undefined
): Promise<boolean> {
  if (!card) return false;

  const ownerIds = Array.from(
    new Set(
      [card.userId, card.assignedUserId]
        .filter((value) => value !== null && value !== undefined && value !== '')
        .map((value) => String(value))
    )
  );
  // A truly ownerless legacy Card keeps its existing compatibility path. Once
  // an owner reference exists, however, the owner must be verifiable.
  if (ownerIds.length === 0) return true;

  try {
    const owners = (await User.find({ _id: { $in: ownerIds } })
      .select('status')
      .lean()) as Array<{ status?: string }>;
    if (owners.length !== ownerIds.length) return false;
    return owners.every((owner) => owner.status !== 'suspended');
  } catch {
    return false;
  }
}

/**
 * True when the Standee owner exists and is not suspended.
 *
 * Standees always require an owner. A missing owner or an owner-lookup error
 * fails closed so an orphaned public record cannot remain reachable.
 */
export async function isStandeeOwnerPubliclyVisible(
  ownerId: unknown
): Promise<boolean> {
  if (ownerId === null || ownerId === undefined || ownerId === '') return false;

  try {
    const owner = (await User.findById(ownerId).select('status').lean()) as {
      status?: string;
    } | null;
    if (!owner) return false;
    return owner.status !== 'suspended';
  } catch {
    return false;
  }
}
