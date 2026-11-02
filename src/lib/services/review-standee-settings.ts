/**
 * Google Review Standee review-host resolution (Phase 4D.6).
 *
 * A Standee is NOT a Card. It has no Card.reviewAssistant, no Card alias and no
 * fake Card record. This service derives an explicit Standee host from:
 *   - an active UserProduct assignment for the canonical Google Review Standee;
 *   - the Standee's own Google Review slot destination (never replaced by a
 *     central URL unless an explicit hybrid override says so);
 *   - the initial source strategy: saved Central Settings when available,
 *     otherwise Standee product settings;
 *   - optional explicit central/hybrid configuration stored on the Standee.
 *
 * The public gate (`STANDEE_REVIEW_ASSISTANT_ENABLED`) defaults OFF. While OFF,
 * callers must keep the original Standee redirect behavior untouched.
 */

import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import ReviewSettings from '@/models/ReviewSettings';
import { getProductCapabilities } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { isSafeExternalUrl } from '@/lib/safe-url';
import {
  STANDEE_REVIEW_ASSISTANT_ENABLED,
} from '@/lib/review-feature-flags';
import {
  getCentralIntegrationRollout,
  isLocalCentralReviewForceAllEnabled,
  resolveEffectiveReviewSettingsSource,
} from '@/lib/services/review-rollout';
import { emitReviewEvent } from '@/lib/services/review-observability';
import {
  resolveReviewSettings,
  type ResolvedReviewSettings,
  type ReviewSettingsSource,
} from '@/lib/services/review-settings-resolver';
import { getReviewLanguageOptions } from '@/lib/services/review-templates';
import { resolveProductTitle } from '@/lib/services/product-title';
import type { IReviewAssistantConfig } from '@/types';

export const GOOGLE_REVIEW_STANDEE_SLUG = 'google-review-standee';

export interface StandeeReviewRecord {
  _id: unknown;
  userId: unknown;
  name?: string;
  displayName?: string;
  routeSlug?: string;
  uid?: string;
  productKey?: string;
  socialQrs?: Array<{
    platform?: string;
    destinationUrl?: string;
    label?: string;
  }>;
  reviewSettingsSource?: unknown;
  reviewSettingsVersion?: number;
  reviewOverrides?: unknown;
}

export interface StandeeReviewProduct {
  assignmentId: string;
  standee: StandeeReviewRecord;
  ownerId: string;
  catalogProductSlug: string;
  productTitle: string;
  googleReviewUrl: string;
  businessName: string;
}

export interface StandeeReviewHost extends StandeeReviewProduct {
  config: ResolvedReviewSettings;
  languages: string[];
  routeSlug: string;
  standeeId: string;
  initials: string;
}

export function isGoogleReviewStandeeSlug(slug: string | undefined): boolean {
  return (slug ?? '').trim().toLowerCase() === GOOGLE_REVIEW_STANDEE_SLUG;
}

export function standeeProductGrantsReview(slug: string | undefined): boolean {
  const productId = resolveCanonicalProductId(slug);
  if (!productId) return false;
  return getProductCapabilities(productId).includes('review_ai_suggestions');
}

/** Public path for the Standee review host. Uses the opaque route/uid. */
export function standeeReviewPath(routeSlug: string): string {
  return `/standee-review/${encodeURIComponent(routeSlug)}`;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Resolve the destination that the Standee already uses for its Google Review
 * slot. Prefer the slot's own dynamic destination, then the shared Profile
 * google_review social link (the same fallback used by /r/ and /qr/).
 */
export async function resolveStandeeGoogleReviewUrl(
  standee: Pick<StandeeReviewRecord, 'userId' | 'socialQrs'>
): Promise<string | null> {
  const slot = (standee.socialQrs ?? []).find(
    (entry) => (entry.platform ?? '').trim().toLowerCase() === 'google_review'
  );
  const direct = slot?.destinationUrl?.trim();
  if (direct && isSafeExternalUrl(direct)) return direct;

  const profile = (await Profile.findOne({ userId: standee.userId })
    .select('socialLinks')
    .lean()) as { socialLinks?: Array<{ platform?: string; url?: string }> } | null;
  const shared = profile?.socialLinks?.find(
    (link) => (link.platform ?? '').trim().toLowerCase() === 'google_review'
  )?.url?.trim();
  return shared && isSafeExternalUrl(shared) ? shared : null;
}

async function loadCentralSettings(userId: string) {
  const doc = (await ReviewSettings.findOne({ businessId: userId })
    .select('schemaVersion general content')
    .lean()
    .exec()) as unknown as {
    schemaVersion?: number;
    general?: unknown;
    content?: unknown;
  } | null;
  if (!doc) return null;
  return {
    schemaVersion: doc.schemaVersion,
    general: doc.general,
    content: doc.content,
  };
}

/**
 * Initial source strategy for a Standee:
 * - an explicit stored source wins;
 * - otherwise use saved central settings when they exist;
 * - otherwise use the Standee's own product settings.
 */
export function resolveStandeeSettingsSource(
  stored: unknown,
  hasCentralSettings: boolean
): ReviewSettingsSource {
  if (stored === 'legacy' || stored === 'central' || stored === 'hybrid') {
    return stored;
  }
  return hasCentralSettings ? 'central' : 'legacy';
}

function standeeLegacyConfig(googleReviewUrl: string): IReviewAssistantConfig {
  return {
    enabled: true,
    googleReviewUrl,
    welcomeMessage: '',
    writingStyle: 'friendly',
    preferredLength: 'medium',
    languages: ['English'],
    feedbackTopics: [],
    category: '',
    employees: [],
    services: [],
    keywords: [],
  };
}

/**
 * Resolve effective Standee settings.
 *
 * The Standee URL is authoritative in every source. Central/hybrid can change
 * content, but never silently replace the Standee's Google destination. Only an
 * explicit hybrid `googleReviewUrl` override is allowed to replace it.
 */
export function resolveStandeeEffectiveReviewSettings(input: {
  standee: StandeeReviewRecord;
  googleReviewUrl: string;
  source: ReviewSettingsSource;
  centralSettings?: unknown;
}): ResolvedReviewSettings {
  const legacy = resolveReviewSettings({
    card: { reviewAssistant: standeeLegacyConfig(input.googleReviewUrl) },
    source: 'legacy',
  });

  if (input.source === 'legacy') return legacy;

  const resolved = resolveReviewSettings({
    card: { reviewAssistant: standeeLegacyConfig(input.googleReviewUrl) },
    source: input.source,
    centralSettings: input.centralSettings,
    overrides: input.standee.reviewOverrides,
  });

  if (resolved.source === 'legacy-fallback') return resolved;

  const overrides =
    input.standee.reviewOverrides &&
    typeof input.standee.reviewOverrides === 'object' &&
    !Array.isArray(input.standee.reviewOverrides)
      ? (input.standee.reviewOverrides as Record<string, unknown>)
      : {};
  const explicitUrlOverride =
    input.source === 'hybrid' && hasOwn(overrides, 'googleReviewUrl');

  return {
    ...resolved,
    googleReviewUrl: explicitUrlOverride ? resolved.googleReviewUrl : input.googleReviewUrl,
  };
}

/**
 * Read-only product/ownership resolution used by management, preview and the
 * public host. It never writes and never creates a Card.
 */
export async function resolveStandeeReviewProduct(
  standee: StandeeReviewRecord
): Promise<StandeeReviewProduct | null> {
  const assignment = (await UserProduct.findOne({
    standeeId: standee._id,
    status: 'active',
  })
    .select('_id userId catalogProductId')
    .populate('catalogProductId', 'name slug kind category')
    .lean()
    .exec()) as unknown as {
    _id: unknown;
    userId: unknown;
    catalogProductId?: { name?: string; slug?: string } | null;
  } | null;

  if (!assignment || !assignment.catalogProductId) return null;
  if (String(assignment.userId) !== String(standee.userId)) return null;

  const slug = (assignment.catalogProductId.slug ?? '').trim().toLowerCase();
  // Capability-based host check: All In One 3/4 declare Google Review support
  // and must be able to use the same assistant. A configured Google review
  // slot is still required below.
  if (!standeeProductGrantsReview(slug)) {
    return null;
  }

  const owner = (await User.findById(standee.userId)
    .select('name status')
    .lean()) as { name?: string; status?: string } | null;
  if (!owner || owner.status === 'suspended') return null;

  const googleReviewUrl = await resolveStandeeGoogleReviewUrl(standee);
  if (!googleReviewUrl) return null;

  const profile = (await Profile.findOne({ userId: standee.userId })
    .select('companyInfo.companyName socialLinks')
    .lean()) as {
    companyInfo?: { companyName?: string };
    socialLinks?: Array<{ platform?: string; url?: string }>;
  } | null;

  const businessName =
    profile?.companyInfo?.companyName?.trim() ||
    standee.displayName?.trim() ||
    standee.name?.trim() ||
    owner.name?.trim() ||
    'Our business';

  return {
    assignmentId: String(assignment._id),
    standee,
    ownerId: String(standee.userId),
    catalogProductSlug: slug,
    productTitle: resolveProductTitle({
      instanceType: 'standee',
      hasInstance: true,
      standee: { displayName: standee.displayName, name: standee.name },
      catalogName: assignment.catalogProductId.name,
    }),
    googleReviewUrl,
    businessName,
  };
}

/**
 * Gate-aware public host resolution. Returns null for OFF, missing/removed
 * assignments, unknown products, suspended owners, missing Google URLs, or
 * disabled effective settings.
 */
export async function resolveStandeeReviewHost(
  routeSlug: string
): Promise<StandeeReviewHost | null> {
  if (!STANDEE_REVIEW_ASSISTANT_ENABLED) return null;
  const key = (routeSlug ?? '').trim().toLowerCase();
  if (!key || key.length > 80 || !/^[a-z0-9_-]+$/.test(key)) return null;

  const standee = (await Standee.findOne({
    $or: [
      { $expr: { $eq: [{ $toLower: '$routeSlug' }, key] } },
      { uid: key },
    ],
  })
    .select(
      '_id userId name displayName routeSlug uid productKey socialQrs reviewSettingsSource reviewSettingsVersion reviewOverrides'
    )
    .lean()) as unknown as StandeeReviewRecord | null;
  if (!standee) return null;

  const product = await resolveStandeeReviewProduct(standee);
  if (!product) return null;

  // Public central reads honor the global gate AND the tenant rollout policy.
  // Management/preview reads remain available regardless of the public gate.
  const requestedCentralSource =
    standee.reviewSettingsSource === 'central' || standee.reviewSettingsSource === 'hybrid';
  const rollout = getCentralIntegrationRollout(product.ownerId);
  // Central ON keeps an explicitly connected Standee on central/hybrid; an
  // unconnected (legacy) Standee stays legacy. Central OFF keeps the
  // historical stored-source/legacy fallback behavior.
  const central = rollout.effective
    ? await loadCentralSettings(product.ownerId)
    : null;
  const storedSource = resolveStandeeSettingsSource(
    standee.reviewSettingsSource,
    Boolean(central)
  );
  const source = resolveEffectiveReviewSettingsSource(storedSource, rollout.effective, {
    forceAll: isLocalCentralReviewForceAllEnabled(),
  });
  if (source !== 'legacy' || requestedCentralSource) {
    const allowed = rollout.effective && source !== 'legacy';
    emitReviewEvent({
      event: allowed ? 'review.rollout.allowed' : 'review.rollout.denied',
      hostType: 'standee',
      tenantId: product.ownerId,
      outcome: allowed ? 'allowed' : 'denied',
      reasonCategory: rollout.reason,
    });
  }
  const config = resolveStandeeEffectiveReviewSettings({
    standee,
    googleReviewUrl: product.googleReviewUrl,
    source,
    centralSettings: central ?? undefined,
  });
  if (!config.enabled) return null;

  const languages = config.category
    ? await getReviewLanguageOptions(config.category)
    : config.languages;
  const resolvedLanguages = languages.length > 0 ? languages : config.languages;
  const route = (standee.routeSlug ?? standee.uid ?? '').trim();
  if (!route) return null;

  const initials = product.businessName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return {
    ...product,
    config,
    languages: resolvedLanguages.length > 0 ? resolvedLanguages : ['English'],
    routeSlug: route,
    standeeId: String(standee._id),
    initials: initials || 'TR',
  };
}

/**
 * Fast gate-aware check used by /r/ and /qr/ before deciding whether an
 * existing printed destination should enter the new host. No settings content
 * is exposed; only eligibility is checked.
 */
export async function isStandeeReviewHostEligible(
  standee: StandeeReviewRecord
): Promise<boolean> {
  if (!STANDEE_REVIEW_ASSISTANT_ENABLED) return false;
  return Boolean(await resolveStandeeReviewProduct(standee));
}

export function standeeHasGoogleReviewSlot(standee: StandeeReviewRecord): boolean {
  return (standee.socialQrs ?? []).some(
    (slot) => (slot.platform ?? '').trim().toLowerCase() === 'google_review'
  );
}
