import { Types, type FilterQuery } from 'mongoose';
import Card from '@/models/Card';
import User from '@/models/User';
import type { AuthUser } from '@/lib/auth';
import { canUseFeature } from '@/lib/services/feature-access';
import { isCardOwnerPubliclyVisible } from '@/lib/services/public-owner-visibility';
import type { CardKind, FeatureKey } from '@/types';

/**
 * Public visibility for cards resolved by NFC/QR/profile URLs.
 *
 * Suspended and ownerless inventory cards stay private. Legacy owner-bound
 * cards that were created before lifecycle status was enforced (or that were
 * assigned without a status update) keep resolving, preserving live URLs.
 * Missing `status` is treated as a legacy active record.
 */
export const PUBLIC_CARD_VISIBILITY: FilterQuery<unknown> = {
  $or: [
    { status: 'active' },
    { status: 'unassigned', userId: { $ne: null } },
    { status: { $exists: false }, userId: { $ne: null } },
  ],
};

/** Merge the public-visibility clause into a card query without losing $or. */
export function withPublicCardVisibility<T = unknown>(
  filter: FilterQuery<T>
): FilterQuery<T> {
  const existing = Array.isArray(filter.$and) ? filter.$and : [];
  return {
    ...filter,
    isActive: true,
    $and: [...existing, PUBLIC_CARD_VISIBILITY],
  };
}

/** Pure mirror of the query clause, used by regression tests. */
export function isPubliclyResolvable(card: {
  isActive?: boolean | null;
  status?: string | null;
  userId?: unknown;
}): boolean {
  if (card.isActive === false) return false;
  if (card.status === 'suspended') return false;
  if (card.status === 'unassigned') return card.userId != null;
  if (card.status === undefined || card.status === null) return card.userId != null;
  return true;
}

export type OwnedCardResult =
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'ok'; card: ReturnType<typeof Card.hydrate> };

function isValidId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Resolve a card by id enforcing ownership (admins bypass).
 * A user "owns" a card either digitally (userId) or as the physical
 * NFC holder (assignedUserId) — both unified after assignment.
 * Returns a discriminated result so routes can map directly to HTTP codes.
 */
export async function getOwnedCard(
  cardId: string,
  user: AuthUser
): Promise<OwnedCardResult> {
  if (!isValidId(cardId)) return { status: 'not_found' };

  const card = await Card.findById(cardId);
  if (!card) return { status: 'not_found' };

  const owns =
    (card.userId !== null && card.userId.toString() === user._id) ||
    (card.assignedUserId !== null && card.assignedUserId.toString() === user._id);
  if (!owns && user.role !== 'admin') return { status: 'forbidden' };

  return { status: 'ok', card };
}

/** Card experience → the product feature that unlocks editing it. */
const CARD_KIND_TO_FEATURE: Record<CardKind, FeatureKey> = {
  profile: 'profile',
  social: 'social',
  review: 'review',
};

/**
 * Whether a user may edit a specific card's experience. Ownership is checked
 * separately (getOwnedCard); this verifies the user's active products grant
 * the experience the CARD belongs to — a user without a matching experience
 * (e.g. a profile-only owner opening a review card) is denied. Admins bypass.
 */
export async function canEditCardExperience(
  user: AuthUser,
  card: { kind?: string | null }
): Promise<boolean> {
  if (user.role === 'admin') return true;
  const key = CARD_KIND_TO_FEATURE[(card.kind as CardKind) ?? 'profile'];
  return canUseFeature(user._id, key);
}

/** Resolve an active, publicly visible card by its url alias (or legacy slug). */
export async function getPublicCardByAlias(alias: string) {
  if (!alias || alias.length > 40) return null;
  const key = alias.toLowerCase();
  // urlAlias is the canonical public handle; slug still resolves after a
  // card is bound so assigned cards never 404 while aliases are assigned.
  const card = await Card.findOne(
    withPublicCardVisibility({
      $or: [{ urlAlias: key }, { slug: key }],
    })
  );
  if (!card) return null;

  // Suspension must revoke a public URL immediately, including legacy cards
  // whose card status was not updated by the admin action. Missing owners and
  // legacy users without an explicit status remain compatible.
  return (await isCardOwnerPubliclyVisible(card)) ? card : null;
}

/**
 * Pick the account's canonical public card — the card served when the account
 * is reached through its company profile slug (/profile/{bizSlug}).
 * Preference: active profile-kind card with a public urlAlias (earliest),
 * then any active card with a urlAlias (earliest), then the earliest active
 * card. Matches both digital owner (userId) and physical holder
 * (assignedUserId) so a bound card always resolves.
 */
async function pickCanonicalPublicCard(userId: unknown) {
  const owned = { $or: [{ userId }, { assignedUserId: userId }] };
  const withAlias = { $exists: true, $nin: ['', null] } as const;

  const profileWithAlias = await Card.findOne(
    withPublicCardVisibility({
      ...owned,
      kind: 'profile',
      urlAlias: withAlias,
    })
  ).sort({ createdAt: 1 });
  if (profileWithAlias) return profileWithAlias;

  const anyWithAlias = await Card.findOne(
    withPublicCardVisibility({
      ...owned,
      urlAlias: withAlias,
    })
  ).sort({ createdAt: 1 });
  if (anyWithAlias) return anyWithAlias;

  return Card.findOne(withPublicCardVisibility({ ...owned })).sort({ createdAt: 1 });
}

/**
 * Resolve the public profile card of the account owning a company business
 * slug (User.bizSlug). Strict non-informative 404 surface for unknown,
 * suspended or slug-less accounts. Case-insensitive; bounded like the alias
 * resolver.
 */
export async function getPublicCardByOwnerBizSlug(slug: string) {
  if (!slug || slug.length > 40) return null;
  const key = slug.toLowerCase();
  const user = await User.findOne({ bizSlug: key, status: 'active' });
  if (!user) return null;
  return pickCanonicalPublicCard(user._id);
}

/**
 * Public profile entry point used by /profile/{alias}. Rule 1 keeps the
 * existing card alias/slug resolution (all URLs ever shared keep working);
 * rule 2 resolves a company business slug to its account's canonical card.
 * A card alias always wins over a same-named business slug so existing URLs
 * are never captured by an account slug.
 */
export async function resolvePublicCardProfile(alias: string) {
  const byAlias = await getPublicCardByAlias(alias);
  if (byAlias) return byAlias;
  return getPublicCardByOwnerBizSlug(alias);
}

/** Redirect-only cards (social/review) must never expose profile data publicly. */
export function isPublicProfileCard(card: { kind?: string } | null | undefined): boolean {
  return !!card && (card.kind ?? 'profile') === 'profile';
}

/**
 * Unify the physical NFC holder and the digital owner for an assigned card.
 * Sets digital ownership (userId), the public handle (urlAlias from slug),
 * a human name, and ensures the card is active & published. Idempotent.
 */
export async function bindAssignedCard(
  card: ReturnType<typeof Card.hydrate>,
  userId: string,
  userName?: string
): Promise<void> {
  const same = (v: unknown) => v !== null && v !== undefined && v.toString() === userId;
  const needsChange =
    !same(card.assignedUserId) ||
    !same(card.userId) ||
    !card.urlAlias ||
    card.status !== 'active' ||
    card.isActive !== true;
  if (!needsChange) return;

  card.assignedUserId = userId;
  card.userId = userId;
  card.status = 'active';
  card.isActive = true;
  if (!card.urlAlias && card.slug) card.urlAlias = card.slug;
  if ((!card.name || card.name === 'Unassigned Card') && userName) card.name = userName;
  await card.save();
}

/**
 * Take an assigned card offline and detach both ownership bindings.
 * Keeps the public URL alias and content so a later reassignment can
 * bring it back online as-is.
 */
export async function unbindAssignedCard(card: ReturnType<typeof Card.hydrate>): Promise<void> {
  const wasBound =
    card.assignedUserId !== null || card.userId !== null || card.isActive !== false;
  if (!wasBound) return;

  card.assignedUserId = null;
  card.userId = null;
  card.status = 'unassigned';
  card.isActive = false;
  await card.save();
}

export function toObjectId(id: string): Types.ObjectId | null {
  if (!isValidId(id)) return null;
  return new Types.ObjectId(id);
}
