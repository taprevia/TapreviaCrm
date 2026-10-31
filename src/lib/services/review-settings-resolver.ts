/**
 * Pure Review settings resolver (Phase 4D.1 foundation).
 *
 * This module is deliberately free of MongoDB, Next.js and any write path. It
 * answers one question: "what effective Review Assistant settings should this
 * product use?" It never mutates the card, never persists a migration and
 * never decides entitlement.
 *
 * Source modes:
 *   legacy  — existing `Card.reviewAssistant` values (default for every card).
 *   central — a valid central settings document plus system defaults.
 *   hybrid  — explicit product overrides, then valid central settings, then
 *             system defaults.
 *
 * If a central/hybrid configuration is missing, malformed or from an
 * unsupported schema version, the whole result falls back to the complete
 * legacy configuration. Partial central data is never mixed with legacy data.
 *
 * This file is a foundation only in Phase 4D.1; production-facing page/API
 * reads are intentionally left unchanged.
 */

import type {
  IReviewAssistantConfig,
  ReviewPreferredLength,
  ReviewWritingStyle,
} from '@/types';
import {
  REVIEW_SETTINGS_SCHEMA_VERSION,
  type ReviewMode,
} from '@/lib/review-settings-defaults';

export { REVIEW_SETTINGS_SCHEMA_VERSION };

const WRITING_STYLES: readonly ReviewWritingStyle[] = [
  'friendly',
  'professional',
  'casual',
  'simple',
];
const PREFERRED_LENGTHS: readonly ReviewPreferredLength[] = [
  'short',
  'medium',
  'detailed',
];

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 50;
const MAX_LANGUAGES = 12;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_URL_LENGTH = 2048;
const MAX_WELCOME_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 60;

export type ReviewSettingsSource = 'legacy' | 'central' | 'hybrid';
export type ResolvedReviewSettingsSource = ReviewSettingsSource | 'legacy-fallback';

export interface ReviewSettingsCardInput {
  reviewAssistant?: unknown;
}

export interface ReviewSettingsGeneralInput {
  enabled?: boolean;
  googleReviewUrl?: string;
  welcomeMessage?: string;
}

export interface ReviewSettingsContentInput {
  category?: string;
  languages?: string[];
  preferredLength?: ReviewPreferredLength;
  writingStyle?: ReviewWritingStyle;
  styleMode?: ReviewMode;
  lengthMode?: ReviewMode;
  feedbackTopics?: string[];
  employees?: string[];
  services?: string[];
  keywords?: string[];
}

export interface CentralReviewSettingsInput {
  schemaVersion?: number;
  general?: ReviewSettingsGeneralInput;
  content?: ReviewSettingsContentInput;
}

export interface ReviewSettingsOverridesInput {
  enabled?: boolean;
  googleReviewUrl?: string;
  welcomeMessage?: string;
  category?: string;
  languages?: string[];
  preferredLength?: ReviewPreferredLength;
  writingStyle?: ReviewWritingStyle;
  styleMode?: ReviewMode;
  lengthMode?: ReviewMode;
  feedbackTopics?: string[];
  employees?: string[];
  services?: string[];
  keywords?: string[];
}

export interface ResolveReviewSettingsInput {
  card?: ReviewSettingsCardInput | null;
  centralSettings?: unknown;
  source?: unknown;
  overrides?: unknown;
}

export interface ResolvedReviewSettings extends IReviewAssistantConfig {
  styleMode: ReviewMode;
  lengthMode: ReviewMode;
  source: ResolvedReviewSettingsSource;
  /** 0 = legacy (no version), 1 = current central/hybrid schema. */
  schemaVersion: number;
}

interface NormalizedValues {
  enabled: boolean;
  googleReviewUrl: string;
  welcomeMessage: string;
  category: string;
  languages: string[];
  preferredLength: ReviewPreferredLength;
  writingStyle: ReviewWritingStyle;
  styleMode: ReviewMode;
  lengthMode: ReviewMode;
  feedbackTopics: string[];
  employees: string[];
  services: string[];
  keywords: string[];
}

type Validation<T> = { ok: true; value: T } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
}

/** Legacy normalization: clean and cap, never reject an existing card value. */
function normalizeTags(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return undefined;
    const tag = raw.trim();
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Strict validation for central/override data: malformed input is rejected. */
function validateStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] | undefined {
  if (!Array.isArray(value) || value.length > maxItems) return undefined;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') return undefined;
    const item = raw.trim();
    if (!item || item.length > maxLength) return undefined;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function validateUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (url.length > MAX_URL_LENGTH) return undefined;
  if (url && !/^https?:\/\//i.test(url)) return undefined;
  return url;
}

function validateString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  if (cleaned.length > maxLength) return undefined;
  return cleaned;
}

function legacyValues(raw: unknown): NormalizedValues {
  const config = isRecord(raw) ? raw : {};
  const languages = normalizeTags(config.languages, MAX_LANGUAGES);
  return {
    // Existing behavior: only the literal boolean true enables the assistant.
    enabled: config.enabled === true,
    googleReviewUrl: cleanString(config.googleReviewUrl, MAX_URL_LENGTH) ?? '',
    welcomeMessage: cleanString(config.welcomeMessage, MAX_WELCOME_LENGTH) ?? '',
    category: cleanString(config.category, MAX_CATEGORY_LENGTH) ?? '',
    // Existing canonical behavior treats an empty language list as English.
    languages: languages && languages.length > 0 ? languages : ['English'],
    preferredLength: PREFERRED_LENGTHS.includes(
      config.preferredLength as ReviewPreferredLength
    )
      ? (config.preferredLength as ReviewPreferredLength)
      : 'medium',
    writingStyle: WRITING_STYLES.includes(config.writingStyle as ReviewWritingStyle)
      ? (config.writingStyle as ReviewWritingStyle)
      : 'friendly',
    // Legacy cards have no varied-selection metadata; they remain fixed.
    styleMode: 'fixed',
    lengthMode: 'fixed',
    feedbackTopics: normalizeTags(config.feedbackTopics, MAX_TAGS) ?? [],
    employees: normalizeTags(config.employees, MAX_TAGS) ?? [],
    services: normalizeTags(config.services, MAX_TAGS) ?? [],
    keywords: normalizeTags(config.keywords, MAX_TAGS) ?? [],
  };
}

/**
 * Validate a central settings fixture/document. Any malformed known field
 * invalidates the whole document; callers then use the complete legacy
 * fallback rather than mixing partial data.
 */
function validateCentral(
  raw: unknown
): Validation<{ values: Partial<NormalizedValues>; schemaVersion: number }> {
  if (!isRecord(raw)) return { ok: false };

  const schemaVersion =
    raw.schemaVersion === undefined
      ? REVIEW_SETTINGS_SCHEMA_VERSION
      : raw.schemaVersion;
  if (
    typeof schemaVersion !== 'number' ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== REVIEW_SETTINGS_SCHEMA_VERSION
  ) {
    return { ok: false };
  }

  const generalRaw = raw.general;
  const contentRaw = raw.content;
  if (
    (generalRaw !== undefined && !isRecord(generalRaw)) ||
    (contentRaw !== undefined && !isRecord(contentRaw))
  ) {
    return { ok: false };
  }

  const general = (generalRaw ?? {}) as Record<string, unknown>;
  const content = (contentRaw ?? {}) as Record<string, unknown>;

  const generalKeys = ['enabled', 'googleReviewUrl', 'welcomeMessage'];
  const contentKeys = [
    'category',
    'languages',
    'preferredLength',
    'writingStyle',
    'styleMode',
    'lengthMode',
    'feedbackTopics',
    'employees',
    'services',
    'keywords',
  ];
  const hasKnownField =
    generalKeys.some((key) => Object.prototype.hasOwnProperty.call(general, key)) ||
    contentKeys.some((key) => Object.prototype.hasOwnProperty.call(content, key));
  if (!hasKnownField) return { ok: false };

  const values: Partial<NormalizedValues> = {};

  if (Object.prototype.hasOwnProperty.call(general, 'enabled')) {
    if (typeof general.enabled !== 'boolean') return { ok: false };
    values.enabled = general.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(general, 'googleReviewUrl')) {
    const url = validateUrl(general.googleReviewUrl);
    if (url === undefined) return { ok: false };
    values.googleReviewUrl = url;
  }
  if (Object.prototype.hasOwnProperty.call(general, 'welcomeMessage')) {
    const message = validateString(general.welcomeMessage, MAX_WELCOME_LENGTH);
    if (message === undefined) return { ok: false };
    values.welcomeMessage = message;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'category')) {
    const category = validateString(content.category, MAX_CATEGORY_LENGTH);
    if (category === undefined) return { ok: false };
    values.category = category;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'languages')) {
    const languages = validateStringArray(content.languages, MAX_LANGUAGES, MAX_LANGUAGE_LENGTH);
    if (!languages) return { ok: false };
    values.languages = languages;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'preferredLength')) {
    if (!PREFERRED_LENGTHS.includes(content.preferredLength as ReviewPreferredLength)) {
      return { ok: false };
    }
    values.preferredLength = content.preferredLength as ReviewPreferredLength;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'writingStyle')) {
    if (!WRITING_STYLES.includes(content.writingStyle as ReviewWritingStyle)) {
      return { ok: false };
    }
    values.writingStyle = content.writingStyle as ReviewWritingStyle;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'styleMode')) {
    if (content.styleMode !== 'fixed' && content.styleMode !== 'varied') {
      return { ok: false };
    }
    values.styleMode = content.styleMode;
  }
  if (Object.prototype.hasOwnProperty.call(content, 'lengthMode')) {
    if (content.lengthMode !== 'fixed' && content.lengthMode !== 'varied') {
      return { ok: false };
    }
    values.lengthMode = content.lengthMode;
  }

  for (const key of ['feedbackTopics', 'employees', 'services', 'keywords'] as const) {
    if (!Object.prototype.hasOwnProperty.call(content, key)) continue;
    const tags = validateStringArray(content[key], MAX_TAGS, MAX_TAG_LENGTH);
    if (!tags) return { ok: false };
    values[key] = tags;
  }

  return { ok: true, value: { values, schemaVersion } };
}

function validateOverrides(raw: unknown): Validation<Partial<NormalizedValues>> {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (!isRecord(raw)) return { ok: false };

  const values: Partial<NormalizedValues> = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'enabled')) {
    if (typeof raw.enabled !== 'boolean') return { ok: false };
    values.enabled = raw.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'googleReviewUrl')) {
    const url = validateUrl(raw.googleReviewUrl);
    if (url === undefined) return { ok: false };
    values.googleReviewUrl = url;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'welcomeMessage')) {
    const message = validateString(raw.welcomeMessage, MAX_WELCOME_LENGTH);
    if (message === undefined) return { ok: false };
    values.welcomeMessage = message;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'category')) {
    const category = validateString(raw.category, MAX_CATEGORY_LENGTH);
    if (category === undefined) return { ok: false };
    values.category = category;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'languages')) {
    const languages = validateStringArray(raw.languages, MAX_LANGUAGES, MAX_LANGUAGE_LENGTH);
    if (!languages) return { ok: false };
    values.languages = languages;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'preferredLength')) {
    if (!PREFERRED_LENGTHS.includes(raw.preferredLength as ReviewPreferredLength)) {
      return { ok: false };
    }
    values.preferredLength = raw.preferredLength as ReviewPreferredLength;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'writingStyle')) {
    if (!WRITING_STYLES.includes(raw.writingStyle as ReviewWritingStyle)) {
      return { ok: false };
    }
    values.writingStyle = raw.writingStyle as ReviewWritingStyle;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'styleMode')) {
    if (raw.styleMode !== 'fixed' && raw.styleMode !== 'varied') return { ok: false };
    values.styleMode = raw.styleMode;
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'lengthMode')) {
    if (raw.lengthMode !== 'fixed' && raw.lengthMode !== 'varied') return { ok: false };
    values.lengthMode = raw.lengthMode;
  }
  for (const key of ['feedbackTopics', 'employees', 'services', 'keywords'] as const) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const tags = validateStringArray(raw[key], MAX_TAGS, MAX_TAG_LENGTH);
    if (!tags) return { ok: false };
    values[key] = tags;
  }
  return { ok: true, value: values };
}

/** Read-safe override projection used by the product list/UI. */
export function normalizeReviewOverrides(raw: unknown): ReviewSettingsOverridesInput {
  const result = validateOverrides(raw);
  return result.ok ? (result.value as ReviewSettingsOverridesInput) : {};
}

function withMetadata(
  values: NormalizedValues,
  source: ResolvedReviewSettingsSource,
  schemaVersion: number
): ResolvedReviewSettings {
  return {
    ...values,
    source,
    schemaVersion,
  };
}

/**
 * Resolve effective Review settings without touching storage.
 *
 * Legacy is the default and is behavior-equivalent to the existing card
 * settings + current defaults. Unknown sources and invalid central/hybrid
 * configurations return the complete legacy configuration with the
 * `legacy-fallback` source marker.
 */
export function resolveReviewSettings(
  input: ResolveReviewSettingsInput
): ResolvedReviewSettings {
  const legacy = legacyValues(input.card?.reviewAssistant);
  const source = input.source;

  if (source === undefined || source === null || source === 'legacy') {
    return withMetadata(legacy, 'legacy', 0);
  }

  if (source !== 'central' && source !== 'hybrid') {
    return withMetadata(legacy, 'legacy-fallback', 0);
  }

  const central = validateCentral(input.centralSettings);
  if (!central.ok) {
    return withMetadata(legacy, 'legacy-fallback', 0);
  }

  if (source === 'central') {
    const defaults = legacyValues(undefined);
    return withMetadata(
      { ...defaults, ...central.value.values },
      'central',
      central.value.schemaVersion
    );
  }

  // Hybrid requires valid central settings; otherwise the safe fallback is the
  // complete legacy configuration (never a partial central/legacy mix).
  const overrides = validateOverrides(input.overrides);
  if (!overrides.ok) {
    return withMetadata(legacy, 'legacy-fallback', 0);
  }

  const defaults = legacyValues(undefined);
  return withMetadata(
    {
      ...defaults,
      ...central.value.values,
      ...overrides.value,
    },
    'hybrid',
    central.value.schemaVersion
  );
}
