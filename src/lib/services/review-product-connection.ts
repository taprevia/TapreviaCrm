/**
 * Explicit product-level connection to central Review Management
 * (Phase 4D.4 for Cards, extended to Google Review Standee in 4D.6).
 *
 * Central-only writes: the connection may select central or update the one
 * product-specific Google destination. Content overrides are never written.
 * Stored legacy/hybrid values remain untouched. It never touches aliases,
 * public URLs, entitlement data or rotation history.
 */

import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import { getSavedReviewSettings } from '@/lib/services/review-management-settings';
import { resolveReviewSettings } from '@/lib/services/review-settings-resolver';
import { resolveStandeeEffectiveReviewSettings } from '@/lib/services/review-standee-settings';
import { isSupportedGoogleReviewUrl } from '@/lib/validation/google-review-url';
import type { ReviewProductConnectionInput } from '@/lib/validation/review-settings';

export type ReviewProductConnectionResult =
  | {
      ok: true;
      source: 'legacy' | 'central' | 'hybrid' | 'destination';
      revision: number;
      effective: {
        enabled: boolean;
        googleReviewUrl: string;
        category: string;
        languages: string[];
        styleMode: 'fixed' | 'varied';
        lengthMode: 'fixed' | 'varied';
      };
    }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409;
      code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';
      message: string;
    };

export async function connectReviewProduct(args: {
  userId: string;
  assignmentId: string;
  input: ReviewProductConnectionInput;
}): Promise<ReviewProductConnectionResult> {
  const lookup = await getReviewProductForUser(args.userId, args.assignmentId);
  if (!lookup.ok) {
    if (lookup.reason === 'invalid') {
      return { ok: false, status: 400, code: 'VALIDATION_ERROR', message: 'Invalid assignment id' };
    }
    if (lookup.reason === 'forbidden') {
      return {
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
        message: 'This product is not eligible for review management',
      };
    }
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Product assignment not found' };
  }
  const product = lookup.product;
  if (!product.productGrantsReview) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'This product does not include the Review Assistant',
    };
  }
  if (!product.eligible) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'This product is not an active review host',
    };
  }

  // Central-only: legacy/hybrid content writes are no longer accepted. Old
  // clients that used hybrid only for a Google destination are tolerated and
  // routed through the destination-only path below; any content key is a clear
  // validation error. Stored legacy/hybrid values remain untouched.
  if (args.input.source === 'legacy') {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message:
        'Central Review Management controls review content. Product-specific legacy review settings cannot be enabled.',
    };
  }

  let destinationUrl: string | null = null;
  if (args.input.source === 'hybrid') {
    const overrides = args.input.overrides ?? {};
    const contentKeys = Object.keys(overrides).filter(
      (key) => key !== 'googleReviewUrl'
    );
    if (contentKeys.length > 0) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message:
          'Central Review Management controls review content. Only a product Google Review destination can be saved.',
      };
    }
    destinationUrl = (overrides.googleReviewUrl ?? '').trim() || null;
    if (!destinationUrl) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'A Google Review destination is required.',
      };
    }
  }

  if (args.input.source === 'destination') {
    destinationUrl = (args.input.destination?.googleReviewUrl ?? '').trim() || null;
    if (!destinationUrl) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'A Google Review destination is required.',
      };
    }
  }

  const target =
    product.instanceType === 'standee'
      ? await Standee.findById(product.standeeId)
          .select('_id userId reviewSettingsVersion reviewOverrides socialQrs')
          .lean<{
            _id: unknown;
            userId: unknown;
            reviewSettingsVersion?: number;
            reviewOverrides?: unknown;
            socialQrs?: Array<{ platform?: string; destinationUrl?: string }>;
          } | null>()
      : await Card.findById(product.cardId)
          .select('_id reviewAssistant reviewSettingsVersion reviewOverrides')
          .lean<{
            _id: unknown;
            reviewAssistant?: unknown;
            reviewSettingsVersion?: number;
            reviewOverrides?: unknown;
          } | null>();

  if (!target) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Product host not found' };
  }

  const currentRevision =
    typeof target.reviewSettingsVersion === 'number' ? target.reviewSettingsVersion : 0;
  if (args.input.revision !== undefined && args.input.revision !== currentRevision) {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: 'This product changed elsewhere. Refresh the product list and try again.',
    };
  }

  const nextRevision = currentRevision + 1;
  const versionFilter =
    currentRevision === 0
      ? { $or: [{ reviewSettingsVersion: 0 }, { reviewSettingsVersion: { $exists: false } }] }
      : { reviewSettingsVersion: currentRevision };

  // Destination-only write. This never changes reviewSettingsSource, never
  // writes content overrides, and never touches publication settings.
  if (destinationUrl) {
    if (!isSupportedGoogleReviewUrl(destinationUrl)) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Enter a supported Google review link.',
      };
    }

    const set: Record<string, unknown> = {
      reviewSettingsVersion: nextRevision,
      reviewSettingsUpdatedAt: new Date(),
      reviewSettingsUpdatedBy: args.userId,
    };

    if (product.instanceType === 'standee') {
      const slots = (target as { socialQrs?: Array<{ platform?: string; destinationUrl?: string }> })
        .socialQrs ?? [];
      const index = slots.findIndex(
        (slot) => (slot.platform ?? '').trim().toLowerCase() === 'google_review'
      );
      if (index < 0) {
        return {
          ok: false,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'This standee has no Google Review profile slot.',
        };
      }
      set[`socialQrs.${index}.destinationUrl`] = destinationUrl;
    } else {
      // Destination is the one product-specific field that remains writable.
      // It is stored in the existing override slot so the effective resolver
      // can keep using it without rewriting content overrides.
      set['reviewOverrides.googleReviewUrl'] = destinationUrl;
    }

    const updated =
      product.instanceType === 'standee'
        ? await Standee.updateOne({ _id: target._id, ...versionFilter }, { $set: set }, {
            runValidators: true,
          })
        : await Card.updateOne({ _id: target._id, ...versionFilter }, { $set: set }, {
            runValidators: true,
          });

    if (updated.modifiedCount !== 1) {
      return {
        ok: false,
        status: 409,
        code: 'CONFLICT',
        message: 'This product changed elsewhere. Refresh the product list and try again.',
      };
    }

    return {
      ok: true,
      source: 'destination',
      revision: nextRevision,
      effective: {
        enabled: product.reviewAssistantEnabled,
        googleReviewUrl: destinationUrl,
        category: '',
        languages: [],
        styleMode: 'fixed',
        lengthMode: 'fixed',
      },
    };
  }

  // Central connection. Content/publication remain central; stored legacy and
  // hybrid values are preserved for rollback/audit and are never unset.
  const saved = await getSavedReviewSettings(args.userId);
  if (!saved.saved) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Save central Review Management settings before connecting a product.',
    };
  }
  const centralSettings = {
    schemaVersion: saved.schemaVersion,
    general: saved.settings.general,
    content: saved.settings.content,
  };

  const effective =
    product.instanceType === 'standee'
      ? resolveStandeeEffectiveReviewSettings({
          standee: {
            _id: target._id,
            userId: (target as { userId?: unknown }).userId,
            reviewSettingsSource: 'central',
            reviewOverrides: (target as { reviewOverrides?: unknown }).reviewOverrides,
          },
          googleReviewUrl: product.standeeGoogleReviewUrl ?? '',
          source: 'central',
          centralSettings,
        })
      : resolveReviewSettings({
          card: { reviewAssistant: (target as { reviewAssistant?: unknown }).reviewAssistant },
          source: 'central',
          centralSettings,
        });

  if (effective.enabled && effective.languages.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'At least one language is required when Review Assistant is enabled.',
    };
  }

  const update = {
    $set: {
      reviewSettingsSource: 'central',
      reviewSettingsVersion: nextRevision,
      reviewSettingsUpdatedAt: new Date(),
      reviewSettingsUpdatedBy: args.userId,
    },
  };

  const updated =
    product.instanceType === 'standee'
      ? await Standee.updateOne({ _id: target._id, ...versionFilter }, update, {
          runValidators: true,
        })
      : await Card.updateOne({ _id: target._id, ...versionFilter }, update, {
          runValidators: true,
        });

  if (updated.modifiedCount !== 1) {
    return {
      ok: false,
      status: 409,
      code: 'CONFLICT',
      message: 'This product changed elsewhere. Refresh the product list and try again.',
    };
  }

  return {
    ok: true,
    source: 'central',
    revision: nextRevision,
    effective: {
      enabled: effective.enabled,
      googleReviewUrl: effective.googleReviewUrl,
      category: effective.category ?? '',
      languages: effective.languages,
      styleMode: effective.styleMode,
      lengthMode: effective.lengthMode,
    },
  };
}
