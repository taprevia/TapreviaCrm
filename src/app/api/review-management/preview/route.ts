import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import { getSavedReviewSettings } from '@/lib/services/review-management-settings';
import { resolveReviewSettings } from '@/lib/services/review-settings-resolver';
import {
  resolveStandeeEffectiveReviewSettings,
  resolveStandeeSettingsSource,
} from '@/lib/services/review-standee-settings';

export const dynamic = 'force-dynamic';

/**
 * GET /api/review-management/preview?assignmentId=...
 *
 * Read-only effective-settings preview. Legacy cards resolve exactly from
 * Card.reviewAssistant. Central/hybrid cards can be resolved from fixtures in
 * isolated tests, but this endpoint never writes, generates a review, creates
 * rotation events or activates central settings.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiEntitlement(request, 'review_ai_suggestions');
    if (auth.status === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (auth.status === 403) {
      return fail(403, 'FORBIDDEN', 'Review Management is not included in your products');
    }

    const assignmentId = (new URL(request.url).searchParams.get('assignmentId') ?? '').trim();
    if (!assignmentId) {
      return fail(400, 'VALIDATION_ERROR', 'assignmentId is required');
    }

    await connectDB();
    const lookup = await getReviewProductForUser(auth.user._id, assignmentId);
    if (!lookup.ok) {
      if (lookup.reason === 'invalid') {
        return fail(400, 'VALIDATION_ERROR', 'Invalid assignment id');
      }
      if (lookup.reason === 'forbidden') {
        return fail(403, 'FORBIDDEN', 'This product is not available for review management');
      }
      return fail(404, 'NOT_FOUND', 'Product assignment not found');
    }

    const product = lookup.product;
    const saved = await getSavedReviewSettings(auth.user._id);
    const centralSettings = saved.saved
      ? {
          schemaVersion: saved.schemaVersion,
          general: saved.settings.general,
          content: saved.settings.content,
        }
      : undefined;

    if (product.instanceType === 'standee') {
      const standee = (await Standee.findById(product.standeeId)
        .select(
          '_id userId name displayName routeSlug uid productKey socialQrs reviewSettingsSource reviewSettingsVersion reviewOverrides'
        )
        .lean()) as unknown as {
        _id: unknown;
        userId: unknown;
        name?: string;
        displayName?: string;
        routeSlug?: string;
        uid?: string;
        socialQrs?: Array<{ platform?: string; destinationUrl?: string }>;
        reviewSettingsSource?: unknown;
        reviewSettingsVersion?: number;
        reviewOverrides?: unknown;
      } | null;
      if (!standee) return fail(404, 'NOT_FOUND', 'Standee not found');

      const source = resolveStandeeSettingsSource(
        standee.reviewSettingsSource,
        saved.saved
      );
      const resolved = resolveStandeeEffectiveReviewSettings({
        standee,
        googleReviewUrl: product.standeeGoogleReviewUrl ?? '',
        source,
        centralSettings,
      });

      return ok({
        assignmentId: product.assignmentId,
        instanceType: 'standee',
        cardId: '',
        standeeId: product.standeeId,
        cardKind: 'standee',
        productTitle: product.productTitle,
        previewAvailable: product.previewAvailable,
        previewUrl: product.previewUrl,
        hostingEnabled: product.hostingEnabled,
        published: resolved.enabled,
        source: resolved.source,
        schemaVersion: resolved.schemaVersion,
        entitlement: {
          accountReviewEntitled: product.accountReviewEntitled,
          productGrantsReview: product.productGrantsReview,
        },
        settings: {
          enabled: resolved.enabled,
          googleReviewUrl: resolved.googleReviewUrl,
          welcomeMessage: resolved.welcomeMessage,
          category: resolved.category,
          languages: resolved.languages,
          writingStyle: resolved.writingStyle,
          preferredLength: resolved.preferredLength,
          styleMode: resolved.styleMode,
          lengthMode: resolved.lengthMode,
          feedbackTopics: resolved.feedbackTopics,
          services: resolved.services,
          employees: resolved.employees,
          keywords: resolved.keywords,
        },
      });
    }

    const card = await Card.findById(product.cardId)
      .select('urlAlias kind reviewAssistant reviewSettingsSource reviewOverrides')
      .lean<{
        urlAlias?: string;
        kind?: string;
        reviewAssistant?: unknown;
        reviewSettingsSource?: unknown;
        reviewOverrides?: unknown;
      } | null>();
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const source = product.settingsSource;
    const resolved = resolveReviewSettings({
      card: { reviewAssistant: card.reviewAssistant },
      centralSettings: source === 'legacy' ? undefined : centralSettings,
      source,
      overrides: card.reviewOverrides,
    });

    const alias = (card.urlAlias ?? '').trim();

    return ok({
      assignmentId: product.assignmentId,
      instanceType: 'card',
      cardId: product.cardId,
      productTitle: product.productTitle,
      cardKind: product.cardKind,
      previewAvailable: product.previewAvailable,
      previewUrl: alias ? `/review/${encodeURIComponent(alias)}` : null,
      hostingEnabled: true,
      published: resolved.enabled,
      source: resolved.source,
      schemaVersion: resolved.schemaVersion,
      entitlement: {
        accountReviewEntitled: product.accountReviewEntitled,
        productGrantsReview: product.productGrantsReview,
      },
      settings: {
        enabled: resolved.enabled,
        googleReviewUrl: resolved.googleReviewUrl,
        welcomeMessage: resolved.welcomeMessage,
        category: resolved.category,
        languages: resolved.languages,
        writingStyle: resolved.writingStyle,
        preferredLength: resolved.preferredLength,
        styleMode: resolved.styleMode,
        lengthMode: resolved.lengthMode,
        feedbackTopics: resolved.feedbackTopics,
        services: resolved.services,
        employees: resolved.employees,
        keywords: resolved.keywords,
      },
    });
  } catch (error) {
    console.error('Review management preview GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
