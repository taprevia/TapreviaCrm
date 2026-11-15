/**
 * Central feature-access resolution for the four core experiences.
 *
 * A customer's access comes from `User → active UserProduct → CatalogProduct
 * experience → fixed access rules`. Active product assignments are the ONLY
 * authority: their grants are merged and the legacy fallback is skipped, so
 * a purchased Google Review product can never be expanded by simply owning a
 * Card.
 *
 * Rules:
 *  - Experience rules are FIXED (src/lib/feature-keys.ts). Product names,
 *    names, materials, sizes and prices never grant access.
 *  - The only product-level variable is the social-links limit:
 *    `CatalogProduct.features.social.max` or the card product definition's
 *    `socialLinksMax`. Defaults to DEFAULT_SOCIAL_LINKS_MAX (4) when unset.
 *    Business and Premium NFC cards opt into 6; every other product remains
 *    at 4. The merge takes the most generous limit across grants and hard-caps
 *    at MAX_SOCIAL_LINKS_MAX (6).
 *  - A feature is enabled if ANY active product grants it.
 *  - Legacy grants (owned active cards / hasStandy) apply ONLY to accounts
 *    with zero active product assignments, so genuinely legacy customers keep
 *    their historical access but legacy fallback can never override a modern
 *    purchase.
 */

import type { FeatureKey, IFeatureConfig } from '@/types';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import {
  DEFAULT_SOCIAL_LINKS_MAX,
  EXPERIENCE_RULES,
  MAX_SOCIAL_LINKS_MAX,
  resolveExperience,
} from '@/lib/feature-keys';
import { getProductCapabilities, getProductDef } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';

export type ResolvedFeatures = Record<FeatureKey, IFeatureConfig>;

const ALL_KEYS: FeatureKey[] = ['profile', 'social', 'review', 'standee'];

const KEY_DEFAULT_MAX: Partial<Record<FeatureKey, number>> = {
  social: DEFAULT_SOCIAL_LINKS_MAX,
};

/** Stored product-level social-links limit override (bounded 1..4 by schema). */
function storedSocialMax(raw: unknown): number | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const social = (raw as Record<string, unknown>)['social'];
  if (!social || typeof social !== 'object') return undefined;
  const max = (social as { max?: unknown }).max;
  if (typeof max !== 'number' || !Number.isFinite(max)) return undefined;
  return Math.min(Math.max(Math.floor(max), 1), DEFAULT_SOCIAL_LINKS_MAX);
}

/** Fixed grants for one catalog product, plus its social-links limit override. */
function productGrants(
  product: { slug?: string; kind?: string; features?: unknown }
): Partial<Record<FeatureKey, IFeatureConfig>> {
  const experience = resolveExperience(product?.kind);
  if (!experience) return {};
  const rules = EXPERIENCE_RULES[experience];
  const grants: Partial<Record<FeatureKey, IFeatureConfig>> = { ...rules.features };
  const productId = resolveCanonicalProductId(product.slug);
  const productDefinition = productId ? getProductDef(productId) : null;

  // Business Profile Standee is the QR-only physical format of the Premium
  // business profile. Its `kind` stays `standee` (for standee identity/QR/
  // analytics), but it additionally grants the profile + social experiences so
  // its linked profile Card is editable through the existing Card PATCH API
  // (`canUseFeature(owner, 'profile')` / `'social'`).
  if (productId === 'BUSINESS_PROFILE_STANDEE') {
    grants.profile = { enabled: true };
    grants.social = { enabled: true };
  }

  if (grants.social?.enabled) {
    // Stored per-product override wins when present; otherwise the card
    // product definition may opt into a higher limit (Business/Premium = 6).
    const explicit = storedSocialMax(product.features);
    const productMax = productDefinition?.socialLinksMax;
    const limit = Math.min(
      Math.max(explicit ?? 0, productMax ?? 0),
      MAX_SOCIAL_LINKS_MAX
    );
    grants.social = {
      enabled: true,
      max: limit || DEFAULT_SOCIAL_LINKS_MAX,
    };
  }

  // Capability-driven review grant: Premium NFC Card is a profile experience
  // that now carries `review_ai_suggestions` in the stable product catalog.
  // The grant is derived from the immutable catalog slug, so existing and new
  // assignments unlock together without a database backfill.
  if (productId) {
    const caps = getProductCapabilities(productId);
    if (caps.includes('review_ai_suggestions')) {
      grants.review = { enabled: true };
    }
  }

  return grants;
}

function merge(base: ResolvedFeatures, grants: Partial<Record<FeatureKey, IFeatureConfig>>): void {
  for (const key of ALL_KEYS) {
    const grant = grants[key];
    if (!grant || !grant.enabled) continue;

    let grantMax = grant.max ?? KEY_DEFAULT_MAX[key];
    if (key === 'social' && grantMax !== undefined) {
      grantMax = Math.min(grantMax, MAX_SOCIAL_LINKS_MAX);
    }

    const currentMax = base[key].max;
    const nextMax =
      currentMax !== undefined && grantMax !== undefined
        ? Math.max(currentMax, grantMax)
        : currentMax ?? grantMax;

    base[key] = { enabled: true, max: nextMax };
  }
}

/** Assemble the fully-resolved feature set for a customer (all keys present). */
export async function resolveFeatureAccess(userId: string | unknown): Promise<ResolvedFeatures> {
  const base: ResolvedFeatures = {
    profile: { enabled: false },
    social: { enabled: false },
    review: { enabled: false },
    standee: { enabled: false },
  };

  if (!userId) return base;

  const uid = String(userId);

  // 1. Modern path — purchased products are the sole authority.
  const activeAssignments = (await UserProduct.find({ userId: uid, status: 'active' })
    .select('catalogProductId')
    .lean()) as unknown as Array<{ catalogProductId: unknown }>;

  if (activeAssignments.length > 0) {
    const catalog = (await CatalogProduct.find({
      _id: { $in: activeAssignments.map((p) => p.catalogProductId) },
    })
      .select('slug kind features')
      .lean()) as unknown as Array<{ slug?: string; kind?: string; features?: unknown }>;

    for (const product of catalog) {
      merge(base, productGrants(product));
    }
    return base;
  }

  // 2. Legacy path — only for accounts with no modern assignments. Mirrors the
  //    fixed experiences so pre-product customers keep their historical access.
  const [ownCards, standeeCount, user] = await Promise.all([
    Card.find({ $or: [{ userId: uid }, { assignedUserId: uid }], isActive: true })
      .select('kind')
      .lean() as unknown as Promise<Array<{ kind?: string }>>,
    Standee.countDocuments({ userId: uid }),
    User.findById(uid).select('hasStandy').lean() as unknown as Promise<
      | { hasStandy?: boolean }
      | null
    >,
  ]);

  for (const card of ownCards) {
    switch (card?.kind) {
      case 'profile':
        merge(base, {
          profile: { enabled: true },
          social: { enabled: true, max: DEFAULT_SOCIAL_LINKS_MAX },
          review: { enabled: true },
        });
        break;
      case 'review':
        merge(base, { review: { enabled: true } });
        break;
      case 'social':
        merge(base, { social: { enabled: true, max: DEFAULT_SOCIAL_LINKS_MAX } });
        break;
      default:
        break;
    }
  }

  if (Boolean(user?.hasStandy) || standeeCount > 0) {
    merge(base, {
      standee: { enabled: true },
      social: { enabled: true, max: DEFAULT_SOCIAL_LINKS_MAX },
    });
  }

  return base;
}

/** True when the customer's purchases grant the given feature. */
export async function canUseFeature(
  userId: string | unknown,
  key: FeatureKey
): Promise<boolean> {
  const features = await resolveFeatureAccess(userId);
  return features[key]?.enabled === true;
}

/** Resolved max limit for a feature, or undefined when unlimited. */
export async function featureMax(
  userId: string | unknown,
  key: FeatureKey
): Promise<number | undefined> {
  const features = await resolveFeatureAccess(userId);
  return features[key]?.max;
}

/**
 * Resolve the social-links limit for one specific Card from its active
 * product assignment. Falls back to the account-level feature max for legacy
 * cards with no active assignment or a product that does not grant social.
 *
 * This is intentionally separate from resolveFeatureAccess(): the account
 * resolver merges every owned product, which would let a 6-link Business/
 * Premium card raise the limit of an unrelated 4-link card on the same account.
 */
export async function resolveCardSocialMax(
  cardId: string | unknown,
  ownerId: string | unknown
): Promise<number | undefined> {
  if (!cardId) return featureMax(ownerId, 'social');

  const assignmentFilter: Record<string, unknown> = { cardId, status: 'active' };
  if (ownerId) assignmentFilter.userId = ownerId;
  const assignments = (await UserProduct.find(assignmentFilter)
    .select('catalogProductId')
    .populate('catalogProductId', 'slug kind features')
    .sort({ createdAt: 1 })
    .lean()) as unknown as Array<{
    catalogProductId?: {
      slug?: string;
      kind?: string;
      features?: unknown;
    } | null;
  }>;

  let limit: number | undefined;
  for (const assignment of assignments) {
    const product = assignment.catalogProductId;
    if (!product) continue;
    const social = productGrants(product).social;
    if (!social?.enabled) continue;
    const candidate = social.max ?? DEFAULT_SOCIAL_LINKS_MAX;
    limit = limit === undefined ? candidate : Math.max(limit, candidate);
  }

  if (limit !== undefined) return Math.min(limit, MAX_SOCIAL_LINKS_MAX);
  // Legacy/unassigned card: preserve the previous account-level behaviour.
  return featureMax(ownerId, 'social');
}

/** Serialisable snapshot for client consumption (GET /api/my/features). */
export function toPublicFeatures(features: ResolvedFeatures) {
  const out: Record<FeatureKey, IFeatureConfig> = {} as Record<FeatureKey, IFeatureConfig>;
  for (const key of ALL_KEYS) {
    out[key] = { enabled: features[key].enabled, ...(features[key].max !== undefined ? { max: features[key].max } : {}) };
  }
  return out;
}

