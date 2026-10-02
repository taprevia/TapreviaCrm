import Card from '@/models/Card';
import { findCardByUid, normalizeCardUidInput, uidConflictForUser } from '@/lib/services/card-identity';

/**
 * Replace the physical card behind an existing product assignment.
 *
 * The SAME Card document carries the digital profile, product config and the
 * permanent routeSlug. Replacing the physical card swaps only `cardUid`
 * (normalized) on that doc — the permanent URL, digital experience and
 * customer ownership are untouched, and the old UID is appended to
 * `previousCardUids` as an audit trail.
 *
 * Safe the moment the new UID is not bound to ANOTHER customer; if it is
 * already bound to the same customer via a different record, we refuse too
 * (one physical UID → one Card record).
 */

export type ReplaceCardResult =
  | { ok: true; status: 200; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export async function replaceCardForAssignment(opts: {
  card: ReturnType<typeof Card.hydrate>;
  ownerUserId: string;
  newUid: string;
}): Promise<ReplaceCardResult> {
  const normalized = normalizeCardUidInput(opts.newUid);
  if (!normalized) {
    return { ok: false, status: 400, error: 'Card UID is invalid' };
  }

  const card = opts.card;
  if (card.assignedUserId?.toString() !== opts.ownerUserId) {
    return { ok: false, status: 409, error: 'This card is not assigned to this user' };
  }

  if (normalized === card.cardUid) {
    return {
      ok: true,
      status: 200,
      data: { cardUid: card.cardUid, slug: card.slug, routeSlug: card.routeSlug, unchanged: true },
    };
  }

  const existing = await findCardByUid(normalized);
  if (existing) {
    const { blocked } = uidConflictForUser(existing, opts.ownerUserId);
    if (blocked) {
      return { ok: false, status: 409, error: 'This Card UID is already assigned to another customer.' };
    }
    // Same customer owns a different Card record with this UID → refuse:
    // a physical UID must map to exactly one Card record.
    if (existing._id.toString() !== card._id.toString()) {
      return { ok: false, status: 409, error: 'This UID is already bound to another record for this customer.' };
    }
  }

  try {
    const previous = card.previousCardUids ?? [];
    if (!previous.includes(card.cardUid)) {
      previous.push(card.cardUid);
    }
    card.cardUid = normalized;
    card.previousCardUids = previous;
    await card.save();

    return {
      ok: true,
      status: 200,
      data: { cardUid: card.cardUid, slug: card.slug, routeSlug: card.routeSlug, unchanged: false },
    };
  } catch (error) {
    // Unique-index violation (rare race): another card claimed the UID between
    // the check and the write.
    if (error instanceof Error && /E11000|duplicate key/i.test(error.message)) {
      return { ok: false, status: 409, error: 'This Card UID is already assigned to another customer.' };
    }
    throw error;
  }
}