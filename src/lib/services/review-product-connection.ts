/**
 * Explicit product-level connection to central Review Management
 * (Phase 4D.4 for Cards, extended to Google Review Standee in 4D.6).
 *
 * Writes only additive source fields on the selected host instance. It never
 * touches Card.reviewAssistant, Standee social QR destinations, aliases, public
 * URLs, entitlement data or rotation history.
 */

import Card from '@/models/Card';
import Standee from '@/models/Standee';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import { getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import { getSavedReviewSettings } from '@/lib/services/review-management-settings';
import { isCentralPublicIntegrationEnabledForTenant } from '@/lib/services/review-rollout';
import { resolveReviewSettings } from '@/lib/services/review-settings-resolver';
import { resolveStandeeEffectiveReviewSettings } from '@/lib/services/review-standee-settings';
import type { ReviewProductConnectionInput } from '@/lib/validation/review-settings';

export type ReviewProductConnectionResult =
  | {
      ok: true;
      source: 'legacy' | 'central' | 'hybrid';
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

const KNOWN_OVERRIDE_KEYS = [
  'enabled',
  'googleReviewUrl',
  'welcomeMessage',
  'category',
  'languages',
  'writingStyle',
  'preferredLength',
  'styleMode',
  'lengthMode',
  'feedbackTopics',
  'services',
  'employees',
  'keywords',
] as const;

async function supportedLanguages(categoryKey: string): Promise<Set<string>> {
  const filter: Record<string, unknown> = { active: true };
  if (categoryKey) filter.categoryKey = categoryKey;
  const rows = (await ReviewTemplate.distinct('language', filter).exec()) as unknown[];
  return new Set(
    rows.map((value) => String(value).trim()).filter((value) => value.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
  // Central ON disables the legacy product-specific workflow for eligible
  // products. The stored legacy settings remain untouched for rollback and
  // become active again when central integration is turned OFF.
  if (
    args.input.source === 'legacy' &&
    isCentralPublicIntegrationEnabledForTenant(args.userId) &&
    (product.settingsSource === 'central' || product.settingsSource === 'hybrid')
  ) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message:
        'Central Review Management is active for this product. Product-specific review settings cannot be enabled while Central Public Review Integration is on.',
    };
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

  let centralSettings: unknown;
  let centralContent: Record<string, unknown> | undefined;
  if (args.input.source !== 'legacy') {
    const saved = await getSavedReviewSettings(args.userId);
    if (!saved.saved) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Save central Review Management settings before connecting a product.',
      };
    }
    centralSettings = {
      schemaVersion: saved.schemaVersion,
      general: saved.settings.general,
      content: saved.settings.content,
    };
    centralContent = saved.settings.content as unknown as Record<string, unknown>;
  }

  const overrides = args.input.source === 'hybrid' ? args.input.overrides : undefined;
  const centralCategory =
    typeof centralContent?.category === 'string'
      ? centralContent.category.trim().toLowerCase()
      : '';
  const centralLanguages = Array.isArray(centralContent?.languages)
    ? centralContent.languages.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const existingOverrides = isRecord(target.reviewOverrides) ? target.reviewOverrides : {};
  const existingCategory =
    typeof existingOverrides.category === 'string'
      ? existingOverrides.category.trim().toLowerCase()
      : '';
  const existingLanguages = Array.isArray(existingOverrides.languages)
    ? existingOverrides.languages.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const previousCategory = existingCategory || centralCategory;
  const previousLanguages = new Set(
    existingLanguages.length > 0 ? existingLanguages : centralLanguages
  );
  const nextCategory =
    overrides?.category !== undefined
      ? overrides.category.trim().toLowerCase()
      : centralCategory;
  const categoryChanged = previousCategory !== nextCategory;

  if (overrides?.category) {
    const active = await ReviewCategory.exists({ key: overrides.category, active: true });
    if (!active && existingCategory !== overrides.category.trim().toLowerCase()) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'The override category is not active.',
      };
    }
  }
  if (overrides?.languages !== undefined) {
    const supported = await supportedLanguages(nextCategory);
    for (const language of overrides.languages) {
      // Preserve an already-saved unsupported value only while the effective
      // category is unchanged; never accept a newly-introduced mismatch.
      if (!supported.has(language) && (categoryChanged || !previousLanguages.has(language))) {
        return {
          ok: false,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: `Language "${language}" is not supported by the selected category.`,
        };
      }
    }
  }

  const effective =
    product.instanceType === 'standee'
      ? resolveStandeeEffectiveReviewSettings({
          standee: {
            _id: target._id,
            userId: (target as { userId?: unknown }).userId,
            reviewSettingsSource: args.input.source,
            reviewOverrides: overrides,
          },
          googleReviewUrl: product.standeeGoogleReviewUrl ?? '',
          source: args.input.source,
          centralSettings,
        })
      : resolveReviewSettings({
          card: { reviewAssistant: (target as { reviewAssistant?: unknown }).reviewAssistant },
          source: args.input.source,
          centralSettings,
          overrides,
        });

  if (effective.enabled && effective.languages.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'At least one language is required when Review Assistant is enabled.',
    };
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

  const set: Record<string, unknown> = {
    reviewSettingsSource: args.input.source,
    reviewSettingsVersion: nextRevision,
    reviewSettingsUpdatedAt: new Date(),
    reviewSettingsUpdatedBy: args.userId,
  };
  const unset: Record<string, 1> = {};
  if (args.input.source === 'hybrid') {
    for (const key of KNOWN_OVERRIDE_KEYS) {
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
        set[`reviewOverrides.${key}`] = (overrides as unknown as Record<string, unknown>)[key];
      } else {
        unset[`reviewOverrides.${key}`] = 1;
      }
    }
  } else {
    unset.reviewOverrides = 1;
  }
  const update: Record<string, unknown> = {
    $set: set,
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
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
    source: args.input.source,
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
