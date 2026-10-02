import { connectDB } from '@/lib/db';
import SystemSettings from '@/models/SystemSettings';
import {
  CARD_TEMPLATE_META,
  defaultTemplateName,
  type CardTemplateMeta,
} from '@/lib/card-templates';

const GLOBAL_KEY = 'global';

type NameMap = Record<string, string>;

/**
 * Read the stored display-name overrides for card templates.
 * Always falls back to an empty map (never throws) so consumers can treat any
 * override set as optional.
 */
export async function getTemplateNameOverrides(): Promise<NameMap> {
  try {
    await connectDB();
    const doc = await SystemSettings.findOne({ key: GLOBAL_KEY }).lean<{
      cardTemplateNames?: NameMap;
    }>();
    const raw = doc?.cardTemplateNames;
    if (!raw || typeof raw !== 'object') return {};
    const out: NameMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch (error) {
    console.error('getTemplateNameOverrides error:', error);
    return {};
  }
}

/** Resolve one template key to its effective display name. */
export function resolveTemplateName(key: string, overrides: NameMap = {}): string {
  const custom = overrides?.[key]?.trim();
  return custom && custom.length > 0 ? custom : defaultTemplateName(key);
}

/** Resolve the full catalog with effective display names applied. */
export function resolveTemplateMeta(overrides: NameMap = {}): CardTemplateMeta[] {
  return CARD_TEMPLATE_META.map((meta) => ({
    ...meta,
    name: resolveTemplateName(meta.key, overrides),
  }));
}

/**
 * Persist display-name overrides for card templates. Only registered template
 * keys are accepted; names are trimmed and length-checked.
 */
export async function saveTemplateNameOverrides(
  names: NameMap
): Promise<{ stored: NameMap; templates: CardTemplateMeta[] }> {
  await connectDB();

  const cleaned: NameMap = {};
  for (const [key, value] of Object.entries(names)) {
    if (!CARD_TEMPLATE_META.some((meta) => meta.key === key)) continue;
    const trimmed = value?.trim() ?? '';
    if (trimmed.length > 0) {
      if (trimmed.length > 40) throw new Error('Template name must be 40 characters or fewer');
      cleaned[key] = trimmed;
    }
  }

  await SystemSettings.findOneAndUpdate(
    { key: GLOBAL_KEY },
    { $set: { cardTemplateNames: cleaned } },
    { upsert: true }
  );

  return {
    stored: cleaned,
    templates: resolveTemplateMeta(cleaned),
  };
}