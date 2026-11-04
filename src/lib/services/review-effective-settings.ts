/**
 * Server-only effective Review settings for a Card (Phase 4D.4, Phase 4
 * central-only).
 *
 * Central Review Management is the single authority for review content and
 * publication. Stored legacy/hybrid values remain readable for historical
 * compatibility, but they can never publish a review or override central
 * content.
 *
 *   Central ON + valid central:  central content/publication wins.
 *   Central ON + missing/invalid central: fail closed (disabled).
 *   Central OFF: fail closed (disabled); legacy content is never reactivated.
 *
 * Product-specific Google Review destinations are retained separately.
 */

import ReviewSettings from '@/models/ReviewSettings';
import {
  resolveReviewSettings,
  type ResolvedReviewSettings,
} from '@/lib/services/review-settings-resolver';
import {
  isCentralPublicIntegrationEnabledForTenant,
  isLocalCentralReviewForceAllEnabled,
} from '@/lib/services/review-rollout';
import { isSafeExternalUrl } from '@/lib/safe-url';

interface CardWithReviewSettings {
  reviewAssistant?: unknown;
  reviewSettingsSource?: unknown;
  reviewOverrides?: unknown;
  userId?: unknown;
  assignedUserId?: unknown;
}

/**
 * Preserve a product-specific Google destination even when central settings are
 * authoritative. Destination is not review content: existing hybrid and
 * legacy card values remain compatible, while central content/publication win.
 */
export function applyCardProductDestination(
  resolved: ResolvedReviewSettings,
  card: CardWithReviewSettings
): ResolvedReviewSettings {
  const overrides = card.reviewOverrides && typeof card.reviewOverrides === 'object'
    ? (card.reviewOverrides as Record<string, unknown>)
    : {};
  const hybridDestination =
    typeof overrides.googleReviewUrl === 'string' ? overrides.googleReviewUrl.trim() : '';
  const legacyDestination =
    card.reviewAssistant && typeof card.reviewAssistant === 'object' &&
    typeof (card.reviewAssistant as Record<string, unknown>).googleReviewUrl === 'string'
      ? String((card.reviewAssistant as Record<string, unknown>).googleReviewUrl).trim()
      : '';
  // Existing hybrid destinations are preserved as a compatibility destination;
  // otherwise the card's legacy destination is the product-specific value.
  const destination = isSafeExternalUrl(hybridDestination)
    ? hybridDestination
    : isSafeExternalUrl(legacyDestination)
      ? legacyDestination
      : '';
  return destination ? { ...resolved, googleReviewUrl: destination } : resolved;
}

export async function resolveEffectiveReviewSettings(
  card: CardWithReviewSettings
): Promise<ResolvedReviewSettings> {
  const ownerId = card.userId ?? card.assignedUserId;
  const centralActive = ownerId
    ? isCentralPublicIntegrationEnabledForTenant(ownerId) || isLocalCentralReviewForceAllEnabled()
    : false;

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

  // Valid central settings are the only content authority. When the public
  // integration gate is OFF, keep the resolved content available for internal
  // previews but force publication closed. This is the central-only contract:
  // a gate switch must never silently reactivate legacy content.
  if (central) {
    const centralResolved = resolveReviewSettings({
      card,
      source: 'central',
      centralSettings: {
        schemaVersion: central.schemaVersion,
        general: central.general,
        content: central.content,
      },
    });

    if (centralResolved.source === 'central') {
      const resolved = applyCardProductDestination(centralResolved, card);
      return centralActive ? resolved : { ...resolved, enabled: false };
    }
  }

  // Missing or invalid central settings: retain legacy content for management
  // display only, never for publication. No legacy `enabled=true` may leak
  // through.
  const fallback = applyCardProductDestination(
    resolveReviewSettings({ card, source: 'legacy' }),
    card
  );
  return { ...fallback, enabled: false, source: 'legacy-fallback' };
}
