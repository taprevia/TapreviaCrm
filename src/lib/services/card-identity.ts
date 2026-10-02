import Card from '@/models/Card';
import type { CardKind } from '@/types';
import { bindAssignedCard } from '@/lib/services/card-access';
import { generateQrId, generateSlug, normalizeCardUid } from '@/lib/utils';

/**
 * Single source of truth for physical Card identity.
 *
 * A Card record IS the physical NFC card. There is no separate inventory —
 * a card is either bound to a customer (assignedUserId/userId set, active)
 * or unbound (sysnonyms: unassigned, in the "pool"). Cards are created at
 * binding time from an admin-supplied UID; they no longer need to be
 * pre-registered.
 *
 * All UIDs are normalized (trim + uppercase) before store/compare so the same
 * physical UID can never be bound twice under a different case.
 */

export const CARD_UID_MAX_LENGTH = 64;

/** Normalize + length-check a UID. Returns null when invalid. */
export function normalizeCardUidInput(uid: string): string | null {
  const normalized = normalizeCardUid(uid);
  if (!normalized) return null;
  if (normalized.length > CARD_UID_MAX_LENGTH) return null;
  return normalized;
}

/**
 * Case-insensitive UID lookup (matches any card bearing the UID).
 *
 * Also matches `previousCardUids` — a UID retired by a card replacement is a
 * de facto conflict and must never be recycled onto another customer.
 */
export async function findCardByUid(uid: string): Promise<ReturnType<typeof Card.hydrate> | null> {
  const normalized = normalizeCardUidInput(uid);
  if (!normalized) return null;
  return Card.findOne({ $or: [{ cardUid: normalized }, { previousCardUids: normalized }] });
}

/**
 * Return the card that blocks a UID from being bound to `forUserId`.
 * Blocks when the UID is bound to a DIFFERENT user (admin-owned/unassigned
 * records and the user's own cards are not conflicts).
 */
export function uidConflictForUser(
  card: ReturnType<typeof Card.hydrate> | null,
  forUserId: string
): { blocked: boolean } {
  if (!card) return { blocked: false };
  const owner = card.assignedUserId ?? card.userId;
  if (owner !== null && owner.toString() === forUserId) return { blocked: false };
  // Unbound cards (status unassigned, no owner) are claimable.
  if (card.status === 'unassigned' && owner === null) return { blocked: false };
  return { blocked: true };
}

/** Generate a unique card slug derived from the UID (deduped against the DB). */
async function createUniqueCardSlug(uid: string): Promise<string> {
  const base = generateSlug(uid.toLowerCase().replace(/_/g, '-')) || `card-${generateQrId(6).toLowerCase()}`;
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Card.exists({ slug: candidate })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Find-or-create the physical card for a UID and bind it to a user.
 *
 * The card is provisioned at binding time — no pre-registered inventory record
 * is required. Existing unassigned card records (the legacy inventory pool) are
 * claimed when their UID matches; otherwise a new Card record is created.
 *
 * Returns a discriminated result; when `conflict`, the UID belongs to another
 * customer and the caller must refuse (never silently reassign).
 */
export type ProvisionCardResult =
  | { ok: true; card: ReturnType<typeof Card.hydrate>; created: boolean }
  | { ok: false; status: number; error: string };

export async function provisionCardForAssignment(opts: {
  uid: string;
  userId: string;
  userName?: string;
  /** The purchased product name — seeded as the card's default label. */
  productName?: string;
  kind: CardKind;
}): Promise<ProvisionCardResult> {
  const normalized = normalizeCardUidInput(opts.uid);
  if (!normalized) {
    return { ok: false, status: 400, error: 'Card UID is invalid' };
  }

  let card = await findCardByUid(normalized);
  let created = false;

  if (card) {
    const { blocked } = uidConflictForUser(card, opts.userId);
    if (blocked) {
      return { ok: false, status: 409, error: 'This Card UID is already assigned' };
    }
  } else {
    card = await Card.create({
      cardUid: normalized,
      status: 'unassigned',
      slug: await createUniqueCardSlug(normalized),
      routeSlug: generateQrId(8),
      kind: 'profile',
      isActive: false,
    });
    created = true;
  }

  await bindAssignedCard(card, opts.userId, opts.userName);

  // The product experience is controlled by the product allocation (admin
  // authoritative). Update the card experience to match the allocated product.
  if (card.kind !== opts.kind) {
    card.kind = opts.kind;
  }
  if (!card.routeSlug) {
    card.routeSlug = generateQrId(8);
  }
  // Default the card's management label to the purchased product name when it
  // has no label yet. Idempotent and never clobbers a custom label — each card
  // owns its own copy, so two cards of the same product start identically but
  // can be renamed independently.
  if (opts.productName && (!card.cardLabel || !card.cardLabel.trim())) {
    card.cardLabel = opts.productName;
  }
  await card.save();

  return { ok: true, card, created };
}