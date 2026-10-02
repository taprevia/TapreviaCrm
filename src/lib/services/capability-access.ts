/**
 * Central capability-based entitlement resolver.
 *
 * A customer's access comes from `User → active UserProduct → ProductDefinition
 * capabilities → merged capability set`. Active product assignments are the
 * ONLY authority.
 *
 * This module extends the existing feature-access.ts to support granular
 * capabilities while maintaining backward compatibility with the legacy
 * feature system.
 */

import type { CapabilityId } from '@/config/capabilities';
import type { ProductId } from '@/config/products';
import { PRODUCT_CATALOG, isProductId, getProductCapabilities, getStandeeProfileConfig } from '@/config/products';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import Standee from '@/models/Standee';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Set of capabilities a customer has access to. */
export type CapabilitySet = Set<CapabilityId>;

/** Standee profile limits for a customer. */
export interface StandeeLimits {
  maxProfiles: number;
  nfcSlots: number;
  qrSlots: number;
  fixedProfiles: string[];
}

/** Full entitlement snapshot for a customer. */
export interface CustomerEntitlement {
  capabilities: CapabilitySet;
  productIds: ProductId[];
  standeeLimits: StandeeLimits | null;
}

/**
 * Generic (non-config, freely-configurable) standee products — e.g. the
 * Counter Standee, whose administrator picks 3–4 social platforms at
 * assignment — derive their platform capabilities from the buyer's standee
 * records, since the platform set is data, not a hard-coded product.
 */
const PLATFORM_BASE_CAP: Record<string, CapabilityId> = {
  instagram: 'instagram',
  google_review: 'google_review',
  whatsapp: 'whatsapp',
  facebook: 'facebook',
  linkedin: 'linkedin',
};

// ─── Core Resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the full entitlement set for a customer.
 *
 * This queries UserProduct assignments, looks up the hard-coded product
 * definitions, and merges all capabilities.
 */
export async function resolveEntitlement(userId: string | unknown): Promise<CustomerEntitlement> {
  const empty: CustomerEntitlement = {
    capabilities: new Set<CapabilityId>(),
    productIds: [],
    standeeLimits: null,
  };

  if (!userId) return empty;
  const uid = String(userId);

  // 1. Fetch active product assignments
  const activeAssignments = (await UserProduct.find({ userId: uid, status: 'active' })
    .select('catalogProductId standeeId')
    .lean()) as unknown as Array<{ catalogProductId: unknown; standeeId?: unknown | null }>;

  if (activeAssignments.length === 0) {
    return empty;
  }

  // 2. Look up CatalogProduct records to get product slugs
  const catalogProducts = (await CatalogProduct.find({
    _id: { $in: activeAssignments.map((p) => p.catalogProductId) },
  })
    .select('slug category kind')
    .lean()) as unknown as Array<{ _id: unknown; slug: string; category?: string; kind?: string }>;

  // 3. Load the buyer's standee instances once, keyed by _id, so generic
  //    standee products can derive their platform capabilities from data.
  const standeeIds = new Set<string>();
  for (const a of activeAssignments) {
    if (a.standeeId) standeeIds.add(String(a.standeeId));
  }
  const standees = standeeIds.size
    ? await Standee.find({ _id: { $in: [...standeeIds] } })
        .select('maxProfiles fixedProfiles')
        .lean()
    : [];
  const standeeById = new Map(standees.map((s) => [String(s._id), s]));

  // 4. Resolve capabilities from hard-coded definitions
  const capabilities = new Set<CapabilityId>();
  const productIds: ProductId[] = [];
  let standeeLimits: StandeeLimits | null = null;

  for (const catalog of catalogProducts) {
    const productId = catalog.slug.toUpperCase().replace(/-/g, '_') as ProductId;

    if (!isProductId(productId)) {
      // Legacy product that doesn't map to our hard-coded catalog
      // Try to find by iterating all products
      const matchedId = Object.keys(PRODUCT_CATALOG).find(
        (id) => id.toLowerCase() === catalog.slug.toLowerCase() ||
                id.replace(/_/g, '-') === catalog.slug.toLowerCase()
      ) as ProductId | undefined;

      if (!matchedId) {
        // Generic standee product (e.g. Counter Standee): the platform set is
        // the buyer's own, so derive capabilities from their standee records.
        if (catalog.category === 'standee' || catalog.kind === 'standee') {
          for (const a of activeAssignments) {
            if (!a.standeeId || String(a.catalogProductId) !== String(catalog._id)) continue;
            const standee = standeeById.get(String(a.standeeId));
            if (!standee) continue;

            for (const platform of standee.fixedProfiles ?? []) {
              const base = PLATFORM_BASE_CAP[platform];
              if (base) capabilities.add(base);
            }

            capabilities.add('standee');
            const profileCount = standee.maxProfiles ?? standee.fixedProfiles?.length ?? 0;
            if (profileCount > 1) capabilities.add('standee_multi_profile');
            capabilities.add('standee_analytics');
            capabilities.add('standee_dynamic_link');

            const config: StandeeLimits = {
              maxProfiles: profileCount,
              nfcSlots: profileCount,
              qrSlots: profileCount,
              fixedProfiles: standee.fixedProfiles ?? [],
            };
            if (!standeeLimits || config.maxProfiles > standeeLimits.maxProfiles) {
              standeeLimits = config;
            }
          }
        }
        continue;
      }

      productIds.push(matchedId);

      const caps = getProductCapabilities(matchedId);
      for (const cap of caps) {
        capabilities.add(cap);
      }

      // Check for standee limits
      const config = getStandeeProfileConfig(matchedId);
      if (config) {
        standeeLimits = config;
      }
    } else {
      productIds.push(productId);

      const caps = getProductCapabilities(productId);
      for (const cap of caps) {
        capabilities.add(cap);
      }

      // Check for standee limits
      const config = getStandeeProfileConfig(productId);
      if (config) {
        // Take the most generous limits
        if (!standeeLimits || config.maxProfiles > standeeLimits.maxProfiles) {
          standeeLimits = config;
        }
      }
    }
  }

  return {
    capabilities,
    productIds: Array.from(new Set(productIds)),
    standeeLimits,
  };
}

// ─── Convenience Functions ────────────────────────────────────────────────────

/**
 * Check if a customer has a specific capability.
 */
export async function hasCapability(
  userId: string | unknown,
  capability: CapabilityId
): Promise<boolean> {
  const entitlement = await resolveEntitlement(userId);
  return entitlement.capabilities.has(capability);
}

/**
 * Check if a customer has ALL of the specified capabilities.
 */
export async function hasAllCapabilities(
  userId: string | unknown,
  capabilities: CapabilityId[]
): Promise<boolean> {
  const entitlement = await resolveEntitlement(userId);
  return capabilities.every((cap) => entitlement.capabilities.has(cap));
}

/**
 * Check if a customer has ANY of the specified capabilities.
 */
export async function hasAnyCapability(
  userId: string | unknown,
  capabilities: CapabilityId[]
): Promise<boolean> {
  const entitlement = await resolveEntitlement(userId);
  return capabilities.some((cap) => entitlement.capabilities.has(cap));
}

/**
 * Get all capabilities for a customer as an array.
 */
export async function getUserCapabilities(userId: string | unknown): Promise<CapabilityId[]> {
  const entitlement = await resolveEntitlement(userId);
  return Array.from(entitlement.capabilities);
}

/**
 * Get all product IDs a customer owns.
 */
export async function getUserProductIds(userId: string | unknown): Promise<ProductId[]> {
  const entitlement = await resolveEntitlement(userId);
  return entitlement.productIds;
}

/**
 * Get standee limits for a customer (null if not a standee product).
 */
export async function getUserStandeeLimits(userId: string | unknown): Promise<StandeeLimits | null> {
  const entitlement = await resolveEntitlement(userId);
  return entitlement.standeeLimits;
}

/**
 * Get the full entitlement snapshot for a customer.
 */
export async function getCustomerEntitlement(userId: string | unknown): Promise<CustomerEntitlement> {
  return resolveEntitlement(userId);
}

// ─── API Response Serialization ───────────────────────────────────────────────

/** Serializable capability set for client consumption. */
export interface SerializedEntitlement {
  capabilities: CapabilityId[];
  productIds: ProductId[];
  standeeLimits: StandeeLimits | null;
}

/**
 * Serialize entitlement for client consumption (GET /api/my/capabilities).
 */
export function serializeEntitlement(entitlement: CustomerEntitlement): SerializedEntitlement {
  return {
    capabilities: Array.from(entitlement.capabilities),
    productIds: Array.from(entitlement.productIds),
    standeeLimits: entitlement.standeeLimits,
  };
}
