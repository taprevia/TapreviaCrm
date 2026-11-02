/**
 * Central ReviewSettings persistence (Phase 4D.2).
 *
 * Server-only. The business id always comes from the authenticated user; no
 * client-supplied tenant id is accepted. Reads never create a document.
 * Writes are field-level, version-guarded and never touch Card.reviewAssistant
 * or rotation collections.
 */

import ReviewSettings from '@/models/ReviewSettings';
import ReviewCategory from '@/models/ReviewCategory';
import ReviewTemplate from '@/models/ReviewTemplate';
import {
  REVIEW_SETTINGS_SCHEMA_VERSION,
  createDefaultReviewSettings,
  type ReviewSettingsValues,
} from '@/lib/review-settings-defaults';
import type { ReviewSettingsPatchInput } from '@/lib/validation/review-settings';

export interface SavedReviewSettings {
  saved: boolean;
  schemaVersion: number;
  /** Additive optimistic-concurrency revision (safe integer as a string). */
  revision: string;
  settings: ReviewSettingsValues;
  updatedAt?: string;
}

export type SaveReviewSettingsResult =
  | { ok: true; saved: SavedReviewSettings }
  | {
      ok: false;
      status: 400 | 409;
      code: 'VALIDATION_ERROR' | 'CONFLICT';
      message: string;
      details?: unknown;
    };

type LeanReviewSettings = {
  _id: unknown;
  businessId: unknown;
  schemaVersion?: number;
  general?: Partial<ReviewSettingsValues['general']>;
  content?: Partial<ReviewSettingsValues['content']>;
  updatedBy?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  __v?: number;
};

function cloneDefaults(): ReviewSettingsValues {
  return createDefaultReviewSettings();
}

type PartialReviewSettingsValues = {
  general?: Partial<ReviewSettingsValues['general']>;
  content?: Partial<ReviewSettingsValues['content']>;
};

function mergeValues(
  base: ReviewSettingsValues,
  source: PartialReviewSettingsValues | null | undefined
): ReviewSettingsValues {
  if (!source) return base;
  return {
    general: {
      enabled:
        source.general?.enabled !== undefined ? source.general.enabled : base.general.enabled,
      googleReviewUrl:
        source.general?.googleReviewUrl !== undefined
          ? source.general.googleReviewUrl
          : base.general.googleReviewUrl,
      welcomeMessage:
        source.general?.welcomeMessage !== undefined
          ? source.general.welcomeMessage
          : base.general.welcomeMessage,
      businessName:
        source.general?.businessName !== undefined
          ? source.general.businessName
          : base.general.businessName,
    },
    content: {
      category:
        source.content?.category !== undefined ? source.content.category : base.content.category,
      languages: Array.isArray(source.content?.languages)
        ? [...source.content.languages]
        : [...base.content.languages],
      writingStyle:
        source.content?.writingStyle !== undefined
          ? source.content.writingStyle
          : base.content.writingStyle,
      preferredLength:
        source.content?.preferredLength !== undefined
          ? source.content.preferredLength
          : base.content.preferredLength,
      styleMode:
        source.content?.styleMode !== undefined
          ? source.content.styleMode
          : base.content.styleMode,
      lengthMode:
        source.content?.lengthMode !== undefined
          ? source.content.lengthMode
          : base.content.lengthMode,
      feedbackTopics: Array.isArray(source.content?.feedbackTopics)
        ? [...source.content.feedbackTopics]
        : [...base.content.feedbackTopics],
      services: Array.isArray(source.content?.services)
        ? [...source.content.services]
        : [...base.content.services],
      employees: Array.isArray(source.content?.employees)
        ? [...source.content.employees]
        : [...base.content.employees],
      keywords: Array.isArray(source.content?.keywords)
        ? [...source.content.keywords]
        : [...base.content.keywords],
    },
  };
}

function docValues(doc: LeanReviewSettings | null): ReviewSettingsValues | null {
  if (!doc) return null;
  return mergeValues(cloneDefaults(), {
    general: doc.general,
    content: doc.content,
  });
}

function serializeSaved(
  doc: LeanReviewSettings,
  values: ReviewSettingsValues
): SavedReviewSettings {
  return {
    saved: true,
    schemaVersion: doc.schemaVersion ?? REVIEW_SETTINGS_SCHEMA_VERSION,
    revision: String(doc.__v ?? 0),
    settings: values,
    ...(doc.updatedAt ? { updatedAt: new Date(doc.updatedAt).toISOString() } : {}),
  };
}

export function serializeDefaults(): SavedReviewSettings {
  return {
    saved: false,
    schemaVersion: REVIEW_SETTINGS_SCHEMA_VERSION,
    revision: '0',
    settings: cloneDefaults(),
  };
}

export async function getSavedReviewSettings(
  businessId: string
): Promise<SavedReviewSettings> {
  const doc = (await ReviewSettings.findOne({ businessId })
    .select('businessId schemaVersion general content updatedAt __v')
    .lean()
    .exec()) as unknown as LeanReviewSettings | null;
  if (!doc) return serializeDefaults();
  const values = docValues(doc);
  if (!values) return serializeDefaults();
  return serializeSaved(doc, values);
}

async function supportedLanguages(categoryKey: string): Promise<Set<string>> {
  const filter: Record<string, unknown> = { active: true };
  if (categoryKey) filter.categoryKey = categoryKey;
  const rows = (await ReviewTemplate.distinct('language', filter).exec()) as unknown[];
  return new Set(
    rows
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0)
  );
}

function categoryChanged(
  current: LeanReviewSettings | null,
  nextCategory: string
): boolean {
  const previous = (current?.content?.category ?? '').trim().toLowerCase();
  return previous !== nextCategory.trim().toLowerCase();
}

async function validateMerged(
  current: LeanReviewSettings | null,
  merged: ReviewSettingsValues,
  patch: ReviewSettingsPatchInput
): Promise<SaveReviewSettingsResult | null> {
  const category = merged.content.category.trim().toLowerCase();
  const previousCategory = (current?.content?.category ?? '').trim().toLowerCase();
  const categoryIsChanging = categoryChanged(current, category);

  if (category) {
    const activeCategory = await ReviewCategory.exists({ key: category, active: true });
    if (!activeCategory) {
      // Preserve an already-saved inactive category; never silently delete it.
      if (previousCategory !== category) {
        return {
          ok: false,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'The selected category is not active.',
          details: { field: 'content.category' },
        };
      }
    }
  }

  // Only validate language support when the caller actually changes the list.
  // Existing legacy values are preserved even if the library no longer serves
  // that language, matching the "do not silently delete" compatibility rule.
  if (patch.content?.languages !== undefined) {
    const supported = await supportedLanguages(category);
    const previousLanguages = new Set(
      (current?.content?.languages ?? []).map((value) => String(value).trim())
    );
    for (const language of merged.content.languages) {
      const isSupported = supported.has(language);
      const isPreservedLegacy =
        !categoryIsChanging && previousLanguages.has(language);
      if (!isSupported && !isPreservedLegacy) {
        return {
          ok: false,
          status: 400,
          code: 'VALIDATION_ERROR',
          message: `Language "${language}" is not supported by the selected Review Library category.`,
          details: { field: 'content.languages', language },
        };
      }
    }
  }

  if (merged.general.enabled && merged.content.languages.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'At least one language is required when Review Assistant is enabled.',
      details: { field: 'content.languages' },
    };
  }

  return null;
}

function buildSet(patch: ReviewSettingsPatchInput, actorId: string): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedBy: actorId };
  if (patch.general) {
    for (const [key, value] of Object.entries(patch.general)) {
      if (value !== undefined) set[`general.${key}`] = value;
    }
  }
  if (patch.content) {
    for (const [key, value] of Object.entries(patch.content)) {
      if (value !== undefined) set[`content.${key}`] = value;
    }
  }
  return set;
}

/**
 * Apply a partial settings patch with optimistic concurrency.
 * Retries a small bounded number of times on duplicate-first-create or a
 * concurrent version change; never performs a read-modify-write blind update.
 */
export async function saveReviewSettings(
  businessId: string,
  actorId: string,
  patch: ReviewSettingsPatchInput,
  expectedRevision?: string
): Promise<SaveReviewSettingsResult> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = (await ReviewSettings.findOne({ businessId })
      .select('businessId schemaVersion general content updatedBy updatedAt __v')
      .lean()
      .exec()) as unknown as LeanReviewSettings | null;

    if (expectedRevision !== undefined) {
      const currentRevision = current ? String(current.__v ?? 0) : '0';
      if (currentRevision !== expectedRevision) {
        return {
          ok: false,
          status: 409,
          code: 'CONFLICT',
          message: 'Review settings changed elsewhere. Reload to review the latest values.',
          details: { reason: 'STALE_SETTINGS', revision: currentRevision },
        };
      }
    }

    const base = docValues(current) ?? cloneDefaults();
    const merged = mergeValues(base, {
      general: patch.general,
      content: patch.content,
    });

    const invalid = await validateMerged(current, merged, patch);
    if (invalid) return invalid;

    if (!current) {
      try {
        const created = await ReviewSettings.create({
          businessId,
          schemaVersion: REVIEW_SETTINGS_SCHEMA_VERSION,
          general: merged.general,
          content: merged.content,
          updatedBy: actorId,
        });
        // A new document must advance the revision immediately. Otherwise two
        // simultaneous first saves could both observe revision "0" and both
        // succeed, defeating the stale-edit contract. The conditional bump also
        // fails safely if another writer updated between create and bump.
        const bumped = (await ReviewSettings.findOneAndUpdate(
          {
            _id: created._id,
            ...(typeof created.__v === 'number'
              ? { __v: created.__v }
              : { __v: { $exists: false } }),
          },
          { $inc: { __v: 1 } },
          { new: true }
        )
          .select('businessId schemaVersion general content updatedBy updatedAt __v')
          .lean()
          .exec()) as unknown as LeanReviewSettings | null;
        if (!bumped) continue;
        const createdValues = docValues(bumped);
        if (!createdValues) {
          return {
            ok: false,
            status: 409,
            code: 'CONFLICT',
            message: 'Could not save review settings. Please retry.',
          };
        }
        return {
          ok: true,
          saved: serializeSaved(bumped, createdValues),
        };
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          // Concurrent first save — retry as an update of the winner.
          continue;
        }
        throw error;
      }
    }

    // Mongoose-created documents carry __v; imported/legacy documents may not.
    // Guard the actual stored shape instead of assuming a version field exists.
    const versionFilter =
      typeof current.__v === 'number'
        ? { __v: current.__v }
        : { __v: { $exists: false } };
    const updated = (await ReviewSettings.findOneAndUpdate(
      { businessId, ...versionFilter },
      { $set: buildSet(patch, actorId), $inc: { __v: 1 } },
      { new: true, runValidators: true }
    )
      .select('businessId schemaVersion general content updatedBy updatedAt __v')
      .lean()
      .exec()) as unknown as LeanReviewSettings | null;

    if (!updated) {
      // Another writer changed the document. Re-read and reapply this patch.
      continue;
    }

    const values = docValues(updated);
    if (!values) {
      return {
        ok: false,
        status: 409,
        code: 'CONFLICT',
        message: 'Could not save review settings. Please retry.',
      };
    }
    return { ok: true, saved: serializeSaved(updated, values) };
  }

  return {
    ok: false,
    status: 409,
    code: 'CONFLICT',
    message: 'Review settings were updated concurrently. Please retry.',
  };
}
