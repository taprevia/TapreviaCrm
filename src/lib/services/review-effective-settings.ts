/**
 * Server-only effective Review settings for a Card (Phase 4D.4).
 *
 * The public integration gate is independent from the copy-flow and rotation
 * flags. While it is OFF, public reads remain strictly legacy even if a Card
 * has reviewSettingsSource='central' or 'hybrid'.
 */

import ReviewSettings from '@/models/ReviewSettings';
import {
  CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED,
} from '@/lib/review-feature-flags';
import {
  resolveReviewSettings,
  type ResolvedReviewSettings,
} from '@/lib/services/review-settings-resolver';

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
  const source =
    card.reviewSettingsSource === 'central' || card.reviewSettingsSource === 'hybrid'
      ? card.reviewSettingsSource
      : 'legacy';

  if (!CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED || source === 'legacy') {
    return resolveReviewSettings({ card, source: 'legacy' });
  }

  const ownerId = card.userId ?? card.assignedUserId;
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
