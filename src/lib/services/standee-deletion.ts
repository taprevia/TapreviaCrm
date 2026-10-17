import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import User from '@/models/User';

/**
 * Canonical standee deletion.
 *
 * A Standee is always paired with exactly one `UserProduct` assignment (the
 * purchase record that also owns the standee entitlement). Deleting the
 * physical/digital standee must therefore cascade:
 *
 *  1. Remove the `Standee` document.
 *  2. Detach it from every `UserProduct` that referenced it (`standeeId: null`)
 *     and retire those assignments (`status: 'removed'`) so no orphaned
 *     reference or stale standee entitlement survives.
 *  3. Flip `User.hasStandy` back to false once the owner has no standees left.
 *
 * Every admin delete endpoint (global `standee-qr` and per-user `standy`) routes
 * through here so the three surfaces can never drift apart.
 */

export type DeleteStandeeResult =
  | { ok: true; userId: string | null; remainingStandees: number }
  | { ok: false; status: 404; error: string };

export interface DeleteStandeeOptions {
  /**
   * When set, deletion is restricted to a standee owned by this user. Used by
   * the per-user endpoint as defense-in-depth; the global admin surface omits
   * it (admins may delete any customer's standee).
   */
  userId?: string;
}

export async function deleteStandeeCascade(
  standeeId: string,
  options: DeleteStandeeOptions = {}
): Promise<DeleteStandeeResult> {
  const query: Record<string, unknown> = { _id: standeeId };
  if (options.userId) query.userId = options.userId;

  const standee = (await Standee.findOne(query)
    .select('userId')
    .lean()) as unknown as { _id: unknown; userId?: unknown } | null;
  if (!standee) {
    return { ok: false, status: 404, error: 'Standee not found' };
  }

  const userId = standee.userId ? String(standee.userId) : null;

  await Standee.deleteOne({ _id: standee._id });

  // Detach + retire the linked purchase assignment(s). This removes the
  // dangling `standeeId` pointer and revokes the standee entitlement that the
  // assignment previously granted.
  await UserProduct.updateMany(
    { standeeId: standee._id },
    { $set: { standeeId: null, status: 'removed' } }
  );

  let remainingStandees = 0;
  if (userId) {
    remainingStandees = await Standee.countDocuments({ userId });
    if (remainingStandees === 0) {
      await User.updateOne(
        { _id: userId, hasStandy: true },
        { $set: { hasStandy: false } }
      );
    }
  }

  return { ok: true, userId, remainingStandees };
}
