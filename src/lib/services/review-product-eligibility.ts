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
import { getProductCapabilities, isProductId, type ProductId } from '@/config/products';
import { resolveProductTitle } from '@/lib/services/product-title';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { resolveEntitlement } from '@/lib/services/capability-access';
import { getSavedReviewSettings } from '@/lib/services/review-management-settings';
import {
  normalizeReviewOverrides,
  resolveReviewSettings,
} from '@/lib/services/review-settings-resolver';
import {
  isGoogleReviewStandeeSlug,
  resolveStandeeEffectiveReviewSettings,
  resolveStandeeGoogleReviewUrl,
  resolveStandeeSettingsSource,
  standeeReviewPath,
  type StandeeReviewRecord,
} from '@/lib/services/review-standee-settings';
import type { ReviewProductOverridesInput } from '@/lib/validation/review-settings';
import type { CapabilityId } from '@/config/capabilities';
import { STANDEE_REVIEW_ASSISTANT_ENABLED } from '@/lib/review-feature-flags';

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
  reviewAssistantEnabled: boolean;
  googleDestinationConfigured: boolean;
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

function normalizedCardSource(value: unknown): ReviewSettingsSource {
  return value === 'central' || value === 'hybrid' ? value : 'legacy';
}

function productGrantsReview(catalogSlug: string | undefined): boolean {
  if (!catalogSlug) return false;
  const productId = catalogSlug.toUpperCase().replace(/-/g, '_');
  if (!isProductId(productId)) return false;
  return getProductCapabilities(productId as ProductId).includes('review_ai_suggestions');
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
  const alias = (card.urlAlias ?? '').trim();
  const eligible = accountReviewEntitled && grants && cardActive && Boolean(alias);
  const source = normalizedCardSource(card.reviewSettingsSource);
  const resolved = resolveReviewSettings({
    card: { reviewAssistant: card.reviewAssistant },
    centralSettings: source === 'legacy' ? undefined : input.centralSettings,
    source,
    overrides: card.reviewOverrides,
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
    settingsSource: source,
    settingsRevision:
      typeof card.reviewSettingsVersion === 'number' ? card.reviewSettingsVersion : 0,
    reviewOverrides: normalizeReviewOverrides(card.reviewOverrides),
    reviewAssistantEnabled: resolved.enabled,
    googleDestinationConfigured: isSafeExternalUrl(resolved.googleReviewUrl),
    productGrantsReview: grants,
    accountReviewEntitled,
    eligible,
    previewAvailable: eligible,
    previewUrl: alias ? `/review/${encodeURIComponent(alias)}` : null,
    hostingEnabled: true,
    futureCentralOptInEligible: eligible && source === 'legacy',
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
  const grants = productGrantsReview(slug) && isGoogleReviewStandeeSlug(slug);
  const googleReviewUrl = await resolveStandeeGoogleReviewUrl(standee);
  const eligible =
    accountReviewEntitled && grants && Boolean(googleReviewUrl);
  const source = resolveStandeeSettingsSource(
    standee.reviewSettingsSource,
    input.hasCentralSettings
  );
  const resolved = resolveStandeeEffectiveReviewSettings({
    standee,
    googleReviewUrl: googleReviewUrl ?? '',
    source,
    centralSettings: input.centralSettings,
  });
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
    settingsSource: source,
    settingsRevision:
      typeof standee.reviewSettingsVersion === 'number'
        ? standee.reviewSettingsVersion
        : 0,
    reviewOverrides: normalizeReviewOverrides(standee.reviewOverrides),
    reviewAssistantEnabled: resolved.enabled,
    googleDestinationConfigured: Boolean(googleReviewUrl),
    standeeGoogleReviewUrl: googleReviewUrl ?? undefined,
    productGrantsReview: grants,
    accountReviewEntitled,
    eligible,
    // Settings preview is useful even while the public Standee gate is OFF;
    // hostingEnabled distinguishes whether the public host can serve.
    previewAvailable: eligible,
    previewUrl: routeSlug ? standeeReviewPath(routeSlug) : null,
    hostingEnabled: STANDEE_REVIEW_ASSISTANT_ENABLED,
    futureCentralOptInEligible: eligible && source === 'legacy',
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
            '_id name cardLabel kind urlAlias isActive status userId assignedUserId reviewAssistant reviewSettingsSource reviewSettingsVersion reviewOverrides'
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
            '_id name cardLabel kind urlAlias isActive status userId assignedUserId reviewAssistant reviewSettingsSource reviewSettingsVersion reviewOverrides'
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
