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
 *    `CatalogProduct.features.social.max` (1–4). Defaults to
 *    DEFAULT_SOCIAL_LINKS_MAX (4) when unset; the merge takes the most
 *    generous limit across grants and hard-caps at the business max.
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
  resolveExperience,
} from '@/lib/feature-keys';

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
  product: { kind?: string; features?: unknown }
): Partial<Record<FeatureKey, IFeatureConfig>> {
  const experience = resolveExperience(product?.kind);
  if (!experience) return {};
  const rules = EXPERIENCE_RULES[experience];
  const grants: Partial<Record<FeatureKey, IFeatureConfig>> = { ...rules.features };

  if (grants.social?.enabled) {
    const explicit = storedSocialMax(product.features);
    grants.social = { enabled: true, max: explicit ?? DEFAULT_SOCIAL_LINKS_MAX };
  }
  return grants;
}

function merge(base: ResolvedFeatures, grants: Partial<Record<FeatureKey, IFeatureConfig>>): void {
  for (const key of ALL_KEYS) {
    const grant = grants[key];
    if (!grant || !grant.enabled) continue;

    let grantMax = grant.max ?? KEY_DEFAULT_MAX[key];
    if (key === 'social' && grantMax !== undefined) {
      grantMax = Math.min(grantMax, DEFAULT_SOCIAL_LINKS_MAX);
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
      .select('kind features')
      .lean()) as unknown as Array<{ kind?: string; features?: unknown }>;

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

/** Serialisable snapshot for client consumption (GET /api/my/features). */
export function toPublicFeatures(features: ResolvedFeatures) {
  const out: Record<FeatureKey, IFeatureConfig> = {} as Record<FeatureKey, IFeatureConfig>;
  for (const key of ALL_KEYS) {
    out[key] = { enabled: features[key].enabled, ...(features[key].max !== undefined ? { max: features[key].max } : {}) };
  }
  return out;
}

