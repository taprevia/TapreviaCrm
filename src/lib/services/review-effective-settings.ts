/**
 * Server-only effective Review settings for a Card (Phase 4D.4).
 *
 * The public integration gate is independent from the copy-flow and rotation
 * flags.
 *   OFF: public reads remain strictly legacy even if a Card has
 *        reviewSettingsSource='central' or 'hybrid'.
 *   ON:  Central Review Management is authoritative for eligible products.
 *        Hybrid overrides are preserved; missing/invalid central settings use
 *        the existing complete-legacy fallback.
 */

import ReviewSettings from '@/models/ReviewSettings';
import {
  resolveReviewSettings,
  type ResolvedReviewSettings,
} from '@/lib/services/review-settings-resolver';
import {
  isCentralPublicIntegrationEnabledForTenant,
  isLocalCentralReviewForceAllEnabled,
  resolveEffectiveReviewSettingsSource,
} from '@/lib/services/review-rollout';

interface CardWithReviewSettings {
  reviewAssistant?: unknown;
  reviewSettingsSource?: unknown;
  reviewOverrides?: unknown;
  userId?: unknown;
  assignedUserId?: unknown;
}

export async function resolveEffectiveReviewSettings(
  card: CardWithReviewSettings
): Promise<ResolvedReviewSettings> {
  const ownerId = card.userId ?? card.assignedUserId;
  // Central ON makes central authoritative for eligible review products.
  // Central OFF resolves exactly as before: legacy public behavior.
  const source = resolveEffectiveReviewSettingsSource(
    card.reviewSettingsSource,
    isCentralPublicIntegrationEnabledForTenant(ownerId),
    { forceAll: isLocalCentralReviewForceAllEnabled() }
  );

  if (source === 'legacy') {
    return resolveReviewSettings({ card, source: 'legacy' });
  }

  const central = ownerId
    ? ((await ReviewSettings.findOne({ businessId: ownerId })
        .select('schemaVersion general content')
        .lean()
        .exec()) as unknown as {
        schemaVersion?: number;
        general?: unknown;
        content?: unknown;
      } | null)
    : null;

  return resolveReviewSettings({
    card,
    source,
    centralSettings: central
      ? {
          schemaVersion: central.schemaVersion,
          general: central.general,
          content: central.content,
        }
      : undefined,
    overrides: card.reviewOverrides,
  });
}
