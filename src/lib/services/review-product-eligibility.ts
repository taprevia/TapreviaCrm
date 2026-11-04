/**
 * Review product eligibility (Phase 4D.2, Standee host added in 4D.6).
 *
 * A review-capable product must:
 *   - be an active UserProduct assignment owned by the authenticated business;
 *   - resolve to a supported host (Card or Google Review Standee);
 *   - belong to an account entitled to `review_ai_suggestions`;
 *   - have a safe public destination.
 *
 * Product names are never used as entitlement shortcuts. Lower-tier Cards do
 * not inherit Premium access, and non-Google-Review standees are not treated as
 * review hosts.
 */

import UserProduct from '@/models/UserProduct';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { getProductCapabilities } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { resolveProductTitle } from '@/lib/services/product-title';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { resolveEntitlement } from '@/lib/services/capability-access';
import { getSavedReviewSettings } from '@/lib/services/review-management-settings';
import {
  normalizeReviewOverrides,
  resolveReviewSettings,
} from '@/lib/services/review-settings-resolver';
import { applyCardProductDestination } from '@/lib/services/review-effective-settings';
import {
  resolveStandeeEffectiveReviewSettings,
  resolveStandeeGoogleReviewUrl,
  standeeReviewPath,
  type StandeeReviewRecord,
} from '@/lib/services/review-standee-settings';
import type { ReviewProductOverridesInput } from '@/lib/validation/review-settings';
import type { CapabilityId } from '@/config/capabilities';
import { STANDEE_REVIEW_ASSISTANT_ENABLED } from '@/lib/review-feature-flags';
import { isCentralPublicIntegrationEnabledForTenant } from '@/lib/services/review-rollout';

export type ReviewSettingsSource = 'legacy' | 'central' | 'hybrid';

export interface EligibleReviewProduct {
  assignmentId: string;
  instanceType: 'card' | 'standee';
  productTitle: string;
  catalogProductSlug: string;
  cardId: string;
  standeeId?: string;
  cardKind: string;
  settingsSource: ReviewSettingsSource;
  settingsRevision: number;
  /** Known saved overrides; unknown/legacy keys stay server-side. */
  reviewOverrides: ReviewProductOverridesInput;
  /** Raw legacy Card settings for the individual Configure editor. */
  legacySettings?: {
    enabled: boolean;
    googleReviewUrl: string;
    welcomeMessage: string;
    category: string;
    languages: string[];
    writingStyle: string;
    preferredLength: string;
    styleMode: string;
    lengthMode: string;
    feedbackTopics: string[];
    services: string[];
    employees: string[];
    keywords: string[];
  };
  reviewAssistantEnabled: boolean;
  /** Central-only publication state for UI status copy. */
  centralSettingsState: 'valid' | 'invalid' | 'missing';
  /** Whether the central public integration gate is active for this tenant. */
  centralPublicActive: boolean;
  googleDestinationConfigured: boolean;
  /** Effective saved destination, used to prefill product setup. */
  effectiveGoogleReviewUrl: string;
  /** Standee's own Google destination (never central's by default). */
  standeeGoogleReviewUrl?: string;
  productGrantsReview: boolean;
  accountReviewEntitled: boolean;
  eligible: boolean;
  previewAvailable: boolean;
  previewUrl: string | null;
  hostingEnabled: boolean;
  futureCentralOptInEligible: boolean;
}

export type ReviewProductLookup =
  | { ok: true; product: EligibleReviewProduct }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'invalid' };

const MAX_ASSIGNMENTS = 100;

interface AssignmentLike {
  _id: unknown;
  cardId?: unknown;
  standeeId?: unknown;
  catalogProductId?: {
    name?: string;
    slug?: string;
    kind?: string;
    category?: string;
  } | null;
}

interface CardLike {
  _id: unknown;
  name?: string;
  cardLabel?: string;
  kind?: string;
  urlAlias?: string;
  /** Legacy printed identity; the public review resolver accepts it too. */
  slug?: string;
  isActive?: boolean;
  status?: string;
  userId?: unknown;
  assignedUserId?: unknown;
  reviewAssistant?: { enabled?: boolean; googleReviewUrl?: string } | null;
  reviewSettingsSource?: unknown;
  reviewSettingsVersion?: number;
  reviewOverrides?: unknown;
}

type StandeeLike = StandeeReviewRecord & {
  reviewSettingsVersion?: number;
};

function productGrantsReview(catalogSlug: string | undefined): boolean {
  if (!catalogSlug) return false;
  const productId = resolveCanonicalProductId(catalogSlug);
  if (!productId) return false;
  return getProductCapabilities(productId).includes('review_ai_suggestions');
}

function isCardOwnedBy(card: { userId?: unknown; assignedUserId?: unknown }, userId: string): boolean {
  return [card.userId, card.assignedUserId].some(
    (value) => value !== null && value !== undefined && String(value) === userId
  );
}

function projectCard(input: {
  assignment: AssignmentLike;
  userId: string;
  card: CardLike | null;
  accountReviewEntitled: boolean;
  centralSettings?: unknown;
}): EligibleReviewProduct | null {
  const { assignment, userId, card, accountReviewEntitled } = input;
  if (!card || !isCardOwnedBy(card, userId)) return null;

  const catalog = assignment.catalogProductId ?? null;
  const slug = (catalog?.slug ?? '').trim().toLowerCase();
  const grants = productGrantsReview(slug);
  const cardActive = card.isActive !== false && card.status !== 'suspended';
  // Public review pages resolve `urlAlias` OR the legacy printed `slug`
  // (see getPublicCardByAlias). Use the same precedence here so historical
  // cards that only carry a slug are not silently denied review setup.
  const alias = (card.urlAlias || card.slug || '').trim();
  const eligible = accountReviewEntitled && grants && cardActive && Boolean(alias);
  const rolloutEnabled = isCentralPublicIntegrationEnabledForTenant(userId);
  // Central-only: valid saved central settings are the only content
  // authority. Missing/invalid central settings keep legacy content available
  // for management display but can never publish. The stored source selector
  // and content overrides are ignored.
  const centralResolved =
    input.centralSettings !== undefined
      ? resolveReviewSettings({
          card: { reviewAssistant: card.reviewAssistant },
          centralSettings: input.centralSettings,
          source: 'central',
        })
      : null;
  const authorityActive = centralResolved?.source === 'central';
  const centralSettingsState: 'valid' | 'invalid' | 'missing' =
    input.centralSettings === undefined
      ? 'missing'
      : authorityActive
        ? 'valid'
        : 'invalid';
  const resolved = authorityActive
    ? applyCardProductDestination(centralResolved!, card as CardLike)
    : applyCardProductDestination(
        resolveReviewSettings({
          card: { reviewAssistant: card.reviewAssistant },
          source: 'legacy',
        }),
        card as CardLike
      );
  const publicationEnabled = rolloutEnabled && authorityActive && resolved.enabled;
  const displaySource: ReviewSettingsSource = authorityActive ? 'central' : 'legacy';
  const legacy = resolveReviewSettings({
    card: { reviewAssistant: card.reviewAssistant },
    source: 'legacy',
  });

  return {
    assignmentId: String(assignment._id),
    instanceType: 'card',
    productTitle: resolveProductTitle({
      instanceType: 'card',
      hasInstance: true,
      card: { cardLabel: card.cardLabel, name: card.name },
      catalogName: catalog?.name,
    }),
    catalogProductSlug: slug,
    cardId: String(card._id),
    cardKind: (card.kind ?? 'profile').trim() || 'profile',
    settingsSource: displaySource,
    settingsRevision:
      typeof card.reviewSettingsVersion === 'number' ? card.reviewSettingsVersion : 0,
    reviewOverrides: normalizeReviewOverrides(card.reviewOverrides),
    legacySettings: {
      enabled: legacy.enabled,
      googleReviewUrl: legacy.googleReviewUrl ?? '',
      welcomeMessage: legacy.welcomeMessage ?? '',
      category: legacy.category ?? '',
      languages: legacy.languages ?? [],
      writingStyle: legacy.writingStyle ?? 'friendly',
      preferredLength: legacy.preferredLength ?? 'medium',
      styleMode: legacy.styleMode ?? 'fixed',
      lengthMode: legacy.lengthMode ?? 'fixed',
      feedbackTopics: legacy.feedbackTopics ?? [],
      services: legacy.services ?? [],
      employees: legacy.employees ?? [],
      keywords: legacy.keywords ?? [],
    },
    reviewAssistantEnabled: publicationEnabled,
    centralSettingsState,
    centralPublicActive: rolloutEnabled,
    googleDestinationConfigured: isSafeExternalUrl(resolved.googleReviewUrl),
    effectiveGoogleReviewUrl: resolved.googleReviewUrl,
    productGrantsReview: grants,
    accountReviewEntitled,
    eligible,
    previewAvailable: eligible,
    previewUrl: alias ? `/review/${encodeURIComponent(alias)}` : null,
    hostingEnabled: true,
    futureCentralOptInEligible: eligible && !authorityActive,
  };
}

async function projectStandee(input: {
  assignment: AssignmentLike;
  userId: string;
  standee: StandeeLike | null;
  accountReviewEntitled: boolean;
  hasCentralSettings: boolean;
  centralSettings?: unknown;
}): Promise<EligibleReviewProduct | null> {
  const { assignment, userId, standee, accountReviewEntitled } = input;
  if (!standee || String(standee.userId) !== userId) return null;

  const catalog = assignment.catalogProductId ?? null;
  const slug = (catalog?.slug ?? '').trim().toLowerCase();
  // Standee review hosts are capability-based. This intentionally includes
  // All In One 3/4 as well as the dedicated Google Review Standee; products
  // without the capability (e.g. Business Profile Standee) remain excluded.
  const grants = productGrantsReview(slug);
  const googleReviewUrl = await resolveStandeeGoogleReviewUrl(standee);
  // Connection/eligibility is capability-based. A missing Google destination
  // is a setup state, not a lack of product entitlement: Review Management must
  // list the standee so the customer can finish setup.
  const connected = accountReviewEntitled && grants;
  const previewReady = connected && Boolean(googleReviewUrl);
  const rolloutEnabled = isCentralPublicIntegrationEnabledForTenant(userId);
  // Central-only: valid central settings are the only content authority. A
  // missing/invalid document keeps legacy content for management display but
  // can never publish; the stored source selector is ignored.
  const centralResolved = input.hasCentralSettings
    ? resolveStandeeEffectiveReviewSettings({
        standee,
        googleReviewUrl: googleReviewUrl ?? '',
        source: 'central',
        centralSettings: input.centralSettings,
      })
    : null;
  const authorityActive = centralResolved?.source === 'central';
  const centralSettingsState: 'valid' | 'invalid' | 'missing' =
    !input.hasCentralSettings ? 'missing' : authorityActive ? 'valid' : 'invalid';
  const resolved = authorityActive
    ? centralResolved!
    : resolveStandeeEffectiveReviewSettings({
        standee,
        googleReviewUrl: googleReviewUrl ?? '',
        source: 'legacy',
      });
  const publicationEnabled = rolloutEnabled && authorityActive && resolved.enabled;
  const displaySource: ReviewSettingsSource = authorityActive ? 'central' : 'legacy';
  const routeSlug = (standee.routeSlug ?? standee.uid ?? '').trim();

  return {
    assignmentId: String(assignment._id),
    instanceType: 'standee',
    productTitle: resolveProductTitle({
      instanceType: 'standee',
      hasInstance: true,
      standee: { displayName: standee.displayName, name: standee.name },
      catalogName: catalog?.name,
    }),
    catalogProductSlug: slug,
    cardId: '',
    standeeId: String(standee._id),
    cardKind: 'standee',
    settingsSource: displaySource,
    settingsRevision:
      typeof standee.reviewSettingsVersion === 'number'
        ? standee.reviewSettingsVersion
        : 0,
    reviewOverrides: normalizeReviewOverrides(standee.reviewOverrides),
    reviewAssistantEnabled: publicationEnabled,
    centralSettingsState,
    centralPublicActive: rolloutEnabled,
    googleDestinationConfigured: Boolean(googleReviewUrl),
    effectiveGoogleReviewUrl: resolved.googleReviewUrl,
    standeeGoogleReviewUrl: googleReviewUrl ?? undefined,
    productGrantsReview: grants,
    accountReviewEntitled,
    eligible: connected,
    // Settings preview requires both a connected product and a configured
    // Google destination. The row remains listed while setup is incomplete.
    previewAvailable: previewReady,
    previewUrl: routeSlug ? standeeReviewPath(routeSlug) : null,
    hostingEnabled: STANDEE_REVIEW_ASSISTANT_ENABLED,
    futureCentralOptInEligible: connected && !authorityActive,
  };
}

export async function listEligibleReviewProducts(
  userId: string
): Promise<EligibleReviewProduct[]> {
  const [assignments, entitlement] = await Promise.all([
    UserProduct.find({ userId, status: 'active' })
      .select('cardId standeeId catalogProductId')
      .populate('catalogProductId', 'name slug kind category')
      .sort({ createdAt: -1 })
      .limit(MAX_ASSIGNMENTS)
      .lean()
      .exec() as unknown as Promise<AssignmentLike[]>,
    resolveEntitlement(userId),
  ]);

  const accountReviewEntitled = entitlement.capabilities.has(
    'review_ai_suggestions' as CapabilityId
  );
  if (assignments.length === 0) return [];

  const cardIds = assignments
    .map((assignment) => assignment.cardId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const standeeIds = assignments
    .map((assignment) => assignment.standeeId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));

  const [cards, standees] = await Promise.all([
    cardIds.length
      ? (Card.find({ _id: { $in: cardIds } })
          .select(
            '_id name cardLabel kind urlAlias slug isActive status userId assignedUserId reviewAssistant reviewSettingsSource reviewSettingsVersion reviewOverrides'
          )
          .lean()
          .exec() as unknown as Promise<CardLike[]>)
      : Promise.resolve([] as CardLike[]),
    standeeIds.length
      ? (Standee.find({ _id: { $in: standeeIds } })
          .select(
            '_id userId name displayName routeSlug uid productKey socialQrs reviewSettingsSource reviewSettingsVersion reviewOverrides'
          )
          .lean()
          .exec() as unknown as Promise<StandeeLike[]>)
      : Promise.resolve([] as StandeeLike[]),
  ]);

  const saved = await getSavedReviewSettings(userId);
  const centralSettings = saved.saved
    ? {
        schemaVersion: saved.schemaVersion,
        general: saved.settings.general,
        content: saved.settings.content,
      }
    : undefined;

  const cardById = new Map(cards.map((card) => [String(card._id), card]));
  const standeeById = new Map(standees.map((standee) => [String(standee._id), standee]));
  const out: EligibleReviewProduct[] = [];

  for (const assignment of assignments) {
    if (assignment.cardId) {
      const projected = projectCard({
        assignment,
        userId,
        card: cardById.get(String(assignment.cardId)) ?? null,
        accountReviewEntitled,
        centralSettings,
      });
      if (projected?.eligible) out.push(projected);
      continue;
    }
    if (assignment.standeeId) {
      const projected = await projectStandee({
        assignment,
        userId,
        standee: standeeById.get(String(assignment.standeeId)) ?? null,
        accountReviewEntitled,
        hasCentralSettings: saved.saved,
        centralSettings,
      });
      if (projected?.eligible) out.push(projected);
    }
  }

  return out;
}

export async function getReviewProductForUser(
  userId: string,
  assignmentId: string
): Promise<ReviewProductLookup> {
  if (!/^[0-9a-fA-F]{24}$/.test(assignmentId)) {
    return { ok: false, reason: 'invalid' };
  }

  const assignment = (await UserProduct.findOne({
    _id: assignmentId,
    userId,
    status: 'active',
  })
    .select('cardId standeeId catalogProductId')
    .populate('catalogProductId', 'name slug kind category')
    .lean()
    .exec()) as unknown as AssignmentLike | null;

  if (!assignment) return { ok: false, reason: 'not_found' };
  if (!assignment.cardId && !assignment.standeeId) return { ok: false, reason: 'not_found' };

  const [card, standee, entitlement, saved] = await Promise.all([
    assignment.cardId
      ? (Card.findById(assignment.cardId)
          .select(
            '_id name cardLabel kind urlAlias slug isActive status userId assignedUserId reviewAssistant reviewSettingsSource reviewSettingsVersion reviewOverrides'
          )
          .lean()
          .exec() as unknown as Promise<CardLike | null>)
      : Promise.resolve(null),
    assignment.standeeId
      ? (Standee.findById(assignment.standeeId)
          .select(
            '_id userId name displayName routeSlug uid productKey socialQrs reviewSettingsSource reviewSettingsVersion reviewOverrides'
          )
          .lean()
          .exec() as unknown as Promise<StandeeLike | null>)
      : Promise.resolve(null),
    resolveEntitlement(userId),
    getSavedReviewSettings(userId),
  ]);

  const accountReviewEntitled = entitlement.capabilities.has(
    'review_ai_suggestions' as CapabilityId
  );
  const centralSettings = saved.saved
    ? {
        schemaVersion: saved.schemaVersion,
        general: saved.settings.general,
        content: saved.settings.content,
      }
    : undefined;

  if (assignment.cardId) {
    if (!card) return { ok: false, reason: 'not_found' };
    if (!isCardOwnedBy(card, userId)) return { ok: false, reason: 'forbidden' };
    const projected = projectCard({
      assignment,
      userId,
      card,
      accountReviewEntitled,
      centralSettings,
    });
    if (!projected) return { ok: false, reason: 'forbidden' };
    if (!accountReviewEntitled) return { ok: false, reason: 'forbidden' };
    if (!projected.productGrantsReview) return { ok: false, reason: 'forbidden' };
    return { ok: true, product: projected };
  }

  if (!standee) return { ok: false, reason: 'not_found' };
  if (String(standee.userId) !== userId) return { ok: false, reason: 'forbidden' };
  const projected = await projectStandee({
    assignment,
    userId,
    standee,
    accountReviewEntitled,
    hasCentralSettings: saved.saved,
    centralSettings,
  });
  if (!projected) return { ok: false, reason: 'forbidden' };
  if (!accountReviewEntitled) return { ok: false, reason: 'forbidden' };
  if (!projected.productGrantsReview) return { ok: false, reason: 'forbidden' };
  return { ok: true, product: projected };
}
