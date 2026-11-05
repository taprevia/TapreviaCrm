import Card from '@/models/Card';
import Profile from '@/models/Profile';
import Standee from '@/models/Standee';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import { generateSlug } from '@/lib/utils';
import { getProductDef } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { nextPermUniqueNumber } from '@/lib/services/customer-identity';
import { withPublicCardVisibility } from '@/lib/services/card-access';
import {
  isCardOwnerPubliclyVisible,
  isStandeeOwnerPubliclyVisible,
} from '@/lib/services/public-owner-visibility';
import {
  allocateStandeePublicSlug,
  isPublicPathReserved,
  reconcileStandeePublicSlug,
} from '@/lib/services/public-url-reservation';

const PUBLIC_SLUG_MAX_LENGTH = 100;
/** Bounded retry budget for concurrent allocation of the same path base. */
const PUBLIC_SLUG_ALLOCATION_ATTEMPTS = 50;

/**
 * Root-level first segments that must never be produced as a business slug —
 * Next.js static prefixes (/admin, /api, /dashboard, /profile, …) always beat
 * the dynamic /[business]/[product] route, so such a URL would never reach the
 * card resolver. Disambiguated with a "-2" suffix at allocation time.
 */
export const RESERVED_PUBLIC_SEGMENTS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'c',
  'dashboard',
  'login',
  'media',
  'panel',
  'profile',
  'qr',
  'r',
  'register',
  'review',
  'standee-review',
  'preview',
  'contacts',
  'privacy',
  'terms',
  'cookies',
  'fonts',
  't',
]);

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Catalog product slug → the product's stable public slug segment.
 * Example: "linkedin-card" → "linkedin" (the ProductDefinition.publicSlug
 * declared in src/config/products.ts). Standees and unknown products have no
 * Card-backed public URL and return null.
 */
export function getPublicProductSlug(catalogSlug: string | null | undefined): string | null {
  if (!catalogSlug) return null;
  const productId = resolveCanonicalProductId(catalogSlug);
  if (!productId) return null;
  return getProductDef(productId).publicSlug ?? null;
}

interface BusinessIdentitySources {
  card?: { basic?: { company?: string | null }; name?: string | null } | null;
  user?: { name?: string | null } | null;
  profile?: { companyInfo?: { companyName?: string | null } | null } | null;
}

/**
 * Priority order for the account's business identity used to derive the
 * business slug. Reads existing stored identity values only — never rewrites
 * them (URL slug is a derived snapshot, not an identity mutation).
 */
export function resolveBusinessNameSource(sources: BusinessIdentitySources): string {
  const cardCompany = sources.card?.basic?.company?.trim();
  if (cardCompany) return cardCompany;
  const companyName = sources.profile?.companyInfo?.companyName?.trim();
  if (companyName) return companyName;
  const cardName = sources.card?.name?.trim();
  if (cardName && cardName !== 'Unassigned Card') return cardName;
  return sources.user?.name?.trim() || 'business';
}

/**
 * Derive + persist the account's unique business slug (User.bizSlug). This is
 * the canonical company profile slug: it stays stable forever once assigned —
 * a company-name change never regenerates it, and a freed suffix is never
 * re-issued to another account (permanent-identity semantics for printed
 * QR / NFC / public URLs).
 *
 * Candidates are driven by a monotonically increasing per-base counter
 * (`bizslug:{base}`), never by a check-then-insert:
 *   - unreserved base: 1 → base, 2 → base-2, 3 → base-3, …
 *   - reserved base (RESERVED_PUBLIC_SEGMENTS): I → base-(I+1) (1 → base-2)
 * A duplicate-key error is kept as a safety net for a legacy/out-of-band slug
 * already holding the candidate (it advances the counter and retries).
 * Idempotent.
 */
export async function ensureUserBizSlug(
  user: { bizSlug?: string | null },
  sourceName: string
): Promise<string> {
  if (user.bizSlug) return user.bizSlug;
  const base = generateSlug(sourceName) || 'business';
  const reserved = RESERVED_PUBLIC_SEGMENTS.has(base);

  for (let attempt = 1; attempt <= 100; attempt++) {
    const index = await nextPermUniqueNumber(`bizslug:${base}`);
    const candidate =
      index === 1 && !reserved ? base : `${base}-${index + (reserved ? 1 : 0)}`;
    try {
      user.bizSlug = candidate;
      await (user as { save(): Promise<unknown> }).save();
      return candidate;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // A legacy/out-of-band slug occupies this candidate — advance and retry.
    }
  }
  throw new Error('Could not allocate a unique business slug');
}

/**
 * Number of cards the account's business namespace already holds for a product
 * slug (any status — including retained-but-unbound cards that keep their
 * publicSlug under the same unique business prefix). Monotonic numbering: next
 * card gets existingCount + 1, so removing a card never renumbers the rest and
 * a retained slug can never be silently re-issued.
 */
async function countProductPathOccurrences(
  productSlug: string,
  bizSlug: string
): Promise<number> {
  const matcher = new RegExp(
    `^${escapeRegExp(bizSlug)}/${escapeRegExp(productSlug)}(?:-[1-9][0-9]*)?$`
  );
  return Card.countDocuments({ publicSlug: matcher });
}

/**
 * Shared Card/Standee public namespace check. The two collections have
 * separate sparse unique indexes, so this application-level guard prevents a
 * new Card and Standee from claiming the same branded path. It also checks the
 * permanent reservation registry so a future Card can never claim a retired
 * Standee path. It does not replace a database index.
 */
async function publicSlugTaken(publicSlug: string): Promise<boolean> {
  const [card, standee, reserved] = await Promise.all([
    Card.exists({ publicSlug }),
    Standee.exists({ publicSlug }),
    isPublicPathReserved(publicSlug),
  ]);
  return Boolean(card || standee || reserved);
}

export interface EnsurePublicSlugResult {
  assigned: boolean;
  publicSlug?: string;
}

/**
 * Ensure a card's human-readable public URL ("{business-slug}/{product-slug}[-N]")
 * exists idempotently. Resolves the card's product via its UserProduct
 * assignment, derives the account business slug, and persists the full path on
 * the card. Concurrency is arbitrated by the unique sparse index (duplicate key
 * → recount + retry). Assigned cards only; cards with no active assignment or a
 * non-Card product are skipped.
 */
export async function ensureCardPublicSlug(
  cardId: string | unknown,
  userId: string | unknown
): Promise<EnsurePublicSlugResult> {
  const card = await Card.findById(cardId);
  if (!card || !userId) return { assigned: false };
  if (card.publicSlug) return { assigned: true, publicSlug: card.publicSlug };

  const assignment = (await UserProduct.findOne({ cardId: card._id, userId, status: 'active' })
    .select('catalogProductId')
    .populate('catalogProductId', 'slug')
    .lean()) as unknown as {
    catalogProductId: { slug?: string } | null;
  } | null;
  const productSlug = getPublicProductSlug(assignment?.catalogProductId?.slug);
  if (!productSlug) return { assigned: false };
  // Deterministic namespace: a card product segment must never occupy the
  // reserved standee review namespace.
  if (STANDEES_RESERVED_PUBLIC_SEGMENTS.has(productSlug)) {
    throw new Error(`Reserved standee public segment cannot be used by a Card: ${productSlug}`);
  }

  const [user, profile] = await Promise.all([
    User.findById(userId),
    Profile.findOne({ userId })
      .select('companyInfo.companyName')
      .lean()
      .then((doc) =>
        (doc as unknown) as { companyInfo?: { companyName?: string | null } } | null
      ),
  ]);
  if (!user) return { assigned: false };

  const bizSlug = await ensureUserBizSlug(
    user,
    resolveBusinessNameSource({ card, user, profile })
  );

  let collisionOffset = 0;
  for (let attempt = 1; attempt <= PUBLIC_SLUG_ALLOCATION_ATTEMPTS; attempt++) {
    const existing =
      (await countProductPathOccurrences(productSlug, bizSlug)) + collisionOffset;
    const productPath = existing === 0 ? productSlug : `${productSlug}-${existing + 1}`;
    const publicSlug = `${bizSlug}/${productPath}`;
    if (await publicSlugTaken(publicSlug)) {
      collisionOffset += 1;
      continue;
    }

    try {
      const result = await Card.updateOne(
        { _id: card._id, publicSlug: { $in: ['', null] } },
        { $set: { publicSlug } }
      );
      if (result.modifiedCount === 1) return { assigned: true, publicSlug };
      // Another request already assigned this card. Return the actual
      // persisted value, never a locally computed candidate.
      const fresh = await Card.findById(card._id).select('publicSlug').lean<{
        publicSlug?: string;
      } | null>();
      if (fresh?.publicSlug) return { assigned: true, publicSlug: fresh.publicSlug };
      collisionOffset += 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Another card claimed this path concurrently; advance and retry.
      collisionOffset += 1;
    }
  }
  throw new Error('Could not allocate a unique card public slug');
}

/**
 * Public product segment used by every standee landing page
 * ("{business-slug}/standee[-N]").
 */
export const STANDEES_PUBLIC_PRODUCT_SEGMENT = 'standee';
/** Reserved for the future dedicated standee review URL (Stage E). */
export const STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT = 'review-standee';
const STANDEES_RESERVED_PUBLIC_SEGMENTS = new Set([
  STANDEES_PUBLIC_PRODUCT_SEGMENT,
  STANDEES_REVIEW_PUBLIC_PRODUCT_SEGMENT,
]);

/**
 * Ensure a standee's public URL ("{business-slug}/standee[-N]") exists
 * idempotently. Allocation is delegated to the permanent reservation registry:
 * a path is reserved before it is written to the Standee, and existing paths
 * are reconciled rather than regenerated. Allocation fails closed until the
 * reservation index and backfill readiness marker exist.
 */
export async function ensureStandeePublicSlug(
  standeeId: string | unknown,
  userId: string | unknown
): Promise<EnsurePublicSlugResult> {
  const standee = await Standee.findById(standeeId);
  if (!standee || !userId) return { assigned: false };

  if (standee.publicSlug) {
    // Existing identifiers are never regenerated. Reconcile the permanent
    // reservation only; a conflict with another identity fails closed.
    const publicSlug = await reconcileStandeePublicSlug({
      standeeId: standee._id,
      ownerId: userId,
      publicSlug: standee.publicSlug,
      source: 'backfill',
    });
    return { assigned: true, publicSlug };
  }

  const [user, profile] = await Promise.all([
    User.findById(userId),
    Profile.findOne({ userId })
      .select('companyInfo.companyName')
      .lean()
      .then((doc) =>
        (doc as unknown) as { companyInfo?: { companyName?: string | null } } | null
      ),
  ]);
  if (!user) return { assigned: false };

  const bizSlug = await ensureUserBizSlug(
    user,
    resolveBusinessNameSource({ user, profile })
  );

  const publicSlug = await allocateStandeePublicSlug({
    standeeId: standee._id,
    ownerId: userId,
    bizSlug,
  });

  return { assigned: true, publicSlug };
}

/**
 * Resolve a standee by its human-readable public URL path
 * ("{business-slug}/standee[-N]"). Fails closed on malformed keys.
 */
export async function getPublicStandeeByPublicSlug(key: string) {
  const normalized = key.toLowerCase();
  if (!normalized || normalized.length > PUBLIC_SLUG_MAX_LENGTH) return null;
  if (!/^[a-z0-9-]{1,50}\/[a-z0-9-]{1,50}$/.test(normalized)) return null;
  const standee = await Standee.findOne({ publicSlug: normalized });
  if (!standee) return null;
  return (await isStandeeOwnerPubliclyVisible(standee.userId)) ? standee : null;
}

/**
 * Resolve an active card by its human-readable public URL path
 * ("{business-slug}/{product-slug}[-N]"). Strict non-informative 404 surface
 * for everything else — no legacy fallbacks here (they stay on their own
 * routes). Fails closed on malformed keys.
 */
export async function getPublicCardByPublicSlug(key: string) {
  const normalized = key.toLowerCase();
  if (!normalized || normalized.length > PUBLIC_SLUG_MAX_LENGTH) return null;
  if (!/^[a-z0-9-]{1,50}\/[a-z0-9-]{1,50}$/.test(normalized)) return null;
  const card = await Card.findOne(withPublicCardVisibility({ publicSlug: normalized }));
  if (!card) return null;
  return (await isCardOwnerPubliclyVisible(card)) ? card : null;
}