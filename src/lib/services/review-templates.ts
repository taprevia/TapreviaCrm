/**
 * Review template engine — the reusable, category-driven suggestions mode.
 *
 * Serves one review suggestion (MAX_SUGGESTIONS = 1) at a time for a card's
 * chosen business category. This is the "no AI" tier: it makes ZERO OpenAI
 * calls and never persists review text — suggestions are computed on demand
 * from the category's template library and the card's own business
 * personalization. "Regenerate" requests a fresh single suggestion, replacing
 * the current one.
 *
 * Selection rules (from the M12 design spec):
 *  1. Card must declare a business `category`, else no suggestions (the
 *     existing AI flow degrades gracefully and keeps working unchanged).
 *  2. Language bucket: exact match preferred, English fallback (top-up only,
 *     never below the requested pool when English has candidates).
 *  3. Length bucket: exact `preferredLength` preferred, other lengths top up.
 *  4. Edibility: a template is only eligible when every placeholder it uses
 *     can be satisfied by REAL business values. An unfillable placeholder
 *     makes the template ineligible — never produces broken/fake text.
 *  5. Anti-repetition: rotate by oldest `lastShownAt`, lowest `usageCount`;
 *     with a single slot the scenario buckets are still ranked deterministically.
 *  6. Substitutions are deterministic and bounded; usage stats are written
 *     best-effort so a store failure can never block suggestions.
 *  7. Session repetition control (M14): templates the visitor already saw are
 *     excluded for that serve; when the remaining pool is too small, eligible
 *     excluded templates are reused, longest-excluded first, deterministically.
 */

import type { ReviewPreferredLength } from '@/types';
import type { ReviewWritingStyle } from '@/types';

export const MAX_SUGGESTIONS = 1;
export const FALLBACK_LANGUAGE = 'English';
/** Server-side cap for session repetition-control ids (client sends <= 12). */
export const MAX_EXCLUDE_TEMPLATE_IDS = 16;

/**
 * Normalize client-supplied exclusion ids: distinct, 24-hex, capped.
 * Malformed ids are dropped defensively — they are a selection preference,
 * never authorization, so they must never break a request.
 */
export function normalizeExcludeTemplateIds(ids: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(ids)) return out;
  for (const raw of ids) {
    if (out.size >= MAX_EXCLUDE_TEMPLATE_IDS) break;
    const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (/^[0-9a-f]{24}$/.test(id)) out.add(id);
  }
  return out;
}

/** The only placeholders a template may use. Anything else is rejected. */
export const ALLOWED_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'businessName',
  'employee',
  'service',
  'keyword',
]);

/** Extract the {placeholders} a template text uses, de-duplicated, in order. */
export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1];
    if (!visited.has(name)) {
      visited.add(name);
      out.push(name);
    }
  }
  return out;
}

/** True when the text contains no ASCII markup that could become HTML/JS. */
export function isMarkupFreeText(text: string): boolean {
  return !/[<>&]/.test(text);
}

export interface ReviewTemplateInput {
  /** Hydrated card — only the fields the engine needs. */
  card: {
    name?: string | null;
    reviewAssistant?: {
      enabled?: boolean;
      category?: string;
      language?: string;
      languages?: string[];
      preferredLength?: ReviewPreferredLength;
      writingStyle?: ReviewWritingStyle;
      employees?: string[];
      services?: string[];
      keywords?: string[];
    } | null;
  };
  language?: string;
  length?: ReviewPreferredLength;
  /** Customer-selected feedback topics — used only for deterministic ranking. */
  topics?: string[];
  /** Customer free-text feedback — used only for deterministic ranking. */
  feedback?: string;
  /**
   * Session-scoped repetition control (M14): template ids recently displayed
   * to this visitor, oldest first. A selection preference only — it never
   * changes category/language/length/style/edibility, never persists, and
   * never acts as authorization.
   */
  excludeTemplateIds?: string[];
  /** Test seam — defaults to now. */
  now?: Date;
}

export interface ReviewTemplateSuggestion {
  templateId: string;
  scenario: string;
  text: string;
}

interface EdibleCandidate {
  _id: unknown;
  scenario: string;
  text: string;
  length: string;
  language: string;
  style?: string;
  compatibleKeywords?: string[];
  usageCount: number;
  lastShownAt: Date | null;
}

function cleanTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0)));
}

/** Rotating fallback pick: employees/services cycle, keyword picks first match. */
function substitute(
  text: string,
  values: {
    businessName: string;
    employees: string[];
    services: string[];
    keywords: string[];
  },
  index: number
): string {
  return text.replace(/\{(\w+)\}/g, (full, name: string) => {
    const n = values.employees.length > 0 ? index % values.employees.length : 0;
    const s = values.services.length > 0 ? index % values.services.length : 0;
    switch (name) {
      case 'businessName':
        return values.businessName;
      case 'employee':
        return values.employees[n] ?? full;
      case 'service':
        return values.services[s] ?? full;
      case 'keyword':
        return values.keywords[0] ?? full;
      default:
        return full;
    }
  });
}

/** Resolve the language bucket: exact match first, English as a top-up. */
function languageBucket(candidates: EdibleCandidate[], language: string): EdibleCandidate[] {
  const exact = candidates.filter((t) => t.language === language);
  if (exact.length >= MAX_SUGGESTIONS) return exact;
  const english = candidates.filter(
    (t) => t.language === FALLBACK_LANGUAGE && t.language !== language
  );
  return [...exact, ...english];
}

function lengthBucket(pool: EdibleCandidate[], preferred: string): EdibleCandidate[] {
  const exact = pool.filter((t) => t.length === preferred);
  if (exact.length >= MAX_SUGGESTIONS) return exact;
  const others = pool.filter((t) => t.length !== preferred);
  return [...exact, ...others];
}

/**
 * Writing-style preference (M13): templates that match the business's stored
 * writingStyle rank ahead of others, but are never filtered out — a pool too
 * small in one style must still be able to fill the single suggestion.
 */
export function styleBucket<T extends { style?: string }>(pool: T[], preferred?: string): T[] {
  if (!preferred) return pool;
  const exact = pool.filter((t) => t.style === preferred);
  const rest = pool.filter((t) => t.style !== preferred);
  return [...exact, ...rest];
}

function isEdible(
  t: EdibleCandidate,
  values: { businessName: string; employees: string[]; services: string[]; keywords: string[] }
): boolean {
  const placeholders = extractPlaceholders(t.text);
  if (placeholders.length === 0) return true;
  return placeholders.every((name) => {
    switch (name) {
      case 'businessName':
        return values.businessName.length > 0;
      case 'employee':
        return values.employees.length > 0;
      case 'service':
        return values.services.length > 0;
      case 'keyword': {
        const compat = cleanTags(t.compatibleKeywords);
        if (compat.length === 0) return values.keywords.length > 0;
        return values.keywords.some((k) => compat.includes(k));
      }
      default:
        return false;
    }
  });
}

/** How much a template uses the business's own personalized values. */
function personalizationHits(
  t: EdibleCandidate,
  values: { businessName: string; employees: string[]; services: string[]; keywords: string[] }
): number {
  const placeholders = extractPlaceholders(t.text);
  let hits = 0;
  if (placeholders.includes('businessName') && values.businessName) hits += 1;
  if (placeholders.includes('employee') && values.employees.length > 0) hits += 2;
  if (placeholders.includes('service') && values.services.length > 0) hits += 2;
  if (placeholders.includes('keyword') && values.keywords.length > 0) hits += 2;
  return hits;
}

/** Writing-style match (M13): exact style outranks other static preference. */
function styleMatchScore(
  t: EdibleCandidate,
  preferred: string | undefined
): number {
  return preferred && t.style && t.style === preferred ? 3 : 0;
}

/**
 * Deterministic, metadata-only relevance: how well a template matches what the
 * customer actually told us (feedback topics + free text mention of the
 * business's own services/employees/keywords). Never fabricates facts — it only
 * ranks existing templates. No review text is stored or logged.
 */
function feedbackScore(
  t: EdibleCandidate,
  values: { services: string[]; employees: string[]; keywords: string[] },
  topics: string[] | undefined,
  feedback: string | undefined
): number {
  let score = 0;
  const raw = t.text.toLowerCase();
  const fb = (feedback ?? '').trim().toLowerCase();

  if (fb) {
    for (const svc of values.services) {
      const s = svc.toLowerCase();
      if (s.length > 2 && fb.includes(s)) score += 1;
    }
    for (const emp of values.employees) {
      const e = emp.toLowerCase();
      if (e.length > 2 && fb.includes(e)) score += 1;
    }
    for (const kw of values.keywords) {
      const k = kw.toLowerCase();
      if (k.length > 2 && fb.includes(k)) score += 2;
    }
  }

  for (const topic of topics ?? []) {
    const tl = topic.toLowerCase().trim();
    if (tl && raw.includes(tl)) score += 2;
  }

  return score;
}

interface RankedCandidate {
  candidate: EdibleCandidate;
  score: number;
}

export async function getReviewTemplateSuggestions(
  input: ReviewTemplateInput
): Promise<ReviewTemplateSuggestion[]> {
  // Lazy import keeps this module a pure IPC leaf until actually used.
  const { default: ReviewTemplate } = await import('@/models/ReviewTemplate');

  const cfg = input.card?.reviewAssistant ?? {};
  const categoryKey = (cfg.category ?? '').trim();
  if (!categoryKey || cfg.enabled === false) return [];

  const language = (input.language ?? '').trim() || (cfg.languages?.[0] ?? '') || FALLBACK_LANGUAGE;
  const preferredLength = (input.length ?? cfg.preferredLength ?? 'medium') as string;
  const now = input.now ?? new Date();

  const businessName = (input.card?.name ?? '').trim();
  const employees = cleanTags(cfg.employees);
  const services = cleanTags(cfg.services);
  const keywords = cleanTags(cfg.keywords);
  const values = { businessName, employees, services, keywords };

  const candidates = (await ReviewTemplate.find({
    categoryKey,
    active: true,
  })
    .lean()
    .exec()) as unknown as EdibleCandidate[];

  let pool = languageBucket(candidates, language);
  pool = lengthBucket(pool, preferredLength);
  pool = styleBucket(pool, cfg.writingStyle);

  const ranked: RankedCandidate[] = pool
    .filter((t) => isEdible(t, values))
    .map((candidate) => ({
      candidate,
      score:
        personalizationHits(candidate, values) +
        feedbackScore(candidate, values, input.topics, input.feedback) +
        styleMatchScore(candidate, cfg.writingStyle),
    }))
    .sort((a, b) => {
      // Rotation first (oldest shown / least used) keeps consecutive serves
      // fresh, then relevance decides order among equally-fresh candidates —
      // so on any fresh pool the customer's feedback/topics/style genuinely
      // shape which suggestions appear first.
      const aAt = a.candidate.lastShownAt ? new Date(a.candidate.lastShownAt).getTime() : 0;
      const bAt = b.candidate.lastShownAt ? new Date(b.candidate.lastShownAt).getTime() : 0;
      if (aAt !== bAt) return aAt - bAt;
      const aUsed = a.candidate.usageCount ?? 0;
      const bUsed = b.candidate.usageCount ?? 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      if (a.score !== b.score) return b.score - a.score;
      return 0;
    });

  if (ranked.length === 0) return [];

  // Session repetition control (M14): exclude the templates this visitor has
  // already been shown this session. Pure selection preference — everything in
  // here is drawn from `ranked` so every normal rule (language, length, style,
  // edibility, score) still holds. Nothing is persisted; excluded templates
  // remain eligible for future serves.
  let rankedPool: RankedCandidate[] = ranked;
  const excludedIds = normalizeExcludeTemplateIds(input.excludeTemplateIds);
  if (excludedIds.size > 0) {
    rankedPool = ranked.filter((r) => !excludedIds.has(String(r.candidate._id).toLowerCase()));
    if (rankedPool.length < MAX_SUGGESTIONS) {
      // Deterministic refill: keep the non-excluded favourites, then top up
      // from the excluded candidates in the order the client recorded them
      // (oldest-excluded first). Excluded ids not present in this ranked pool
      // (e.g. different language/length or inedible here) are skipped so the
      // refill can never fabricate or bypass normal eligibility.
      const byId = new Map<string, RankedCandidate>();
      for (const r of ranked) {
        byId.set(String(r.candidate._id).toLowerCase(), r);
      }
      const seen = new Set(rankedPool.map((r) => String(r.candidate._id).toLowerCase()));
      const refill: RankedCandidate[] = [...rankedPool];
      for (const id of input.excludeTemplateIds ?? []) {
        const match = byId.get(id.trim().toLowerCase());
        if (match && !seen.has(id.trim().toLowerCase())) {
          seen.add(id.trim().toLowerCase());
          refill.push(match);
        }
      }
      rankedPool = refill;
    }
  }

  // Scenario diversity: round-robin — one pick per scenario bucket per pass.
  // Each bucket is already ranked so the first candidate is the most relevant.
  // With MAX_SUGGESTIONS = 1 the first (most relevant) bucket's top pick is
  // the sole suggestion served.
  const buckets: EdibleCandidate[][] = [];
  const byScenario = new Map<string, EdibleCandidate[]>();
  for (const { candidate } of rankedPool) {
    const list = byScenario.get(candidate.scenario) ?? [];
    list.push(candidate);
    byScenario.set(candidate.scenario, list);
  }
  for (const list of byScenario.values()) buckets.push([...list]);

  const selected: EdibleCandidate[] = [];
  while (selected.length < MAX_SUGGESTIONS && buckets.some((b) => b.length > 0)) {
    for (const bucket of buckets) {
      if (selected.length >= MAX_SUGGESTIONS) break;
      const pick = bucket.shift();
      if (pick) selected.push(pick);
    }
  }

  const suggestions: ReviewTemplateSuggestion[] = selected.map((t, index) => ({
    templateId: String(t._id),
    scenario: t.scenario,
    text: substitute(t.text, values, index),
  }));

  // Best-effort usage tracking — never blocks or fails the response.
  try {
    await ReviewTemplate.updateMany(
      { _id: { $in: selected.map((t) => t._id) } },
      { $inc: { usageCount: 1 }, $set: { lastShownAt: now } }
    ).exec();
  } catch {
    /* non-critical rotation metrics */
  }

  return suggestions;
}

/** Minimal serialisable category shape shared by the public + builder UIs. */
export interface ReviewCategoryOption {
  key: string;
  name: string;
}

export async function getActiveReviewCategories(): Promise<ReviewCategoryOption[]> {
  const { default: ReviewCategory } = await import('@/models/ReviewCategory');
  const rows = (await ReviewCategory.find({ active: true })
    .sort({ name: 1 })
    .select('key name')
    .lean()
    .exec()) as unknown as Array<{ key: string; name: string }>;
  return rows.map((r) => ({ key: r.key, name: r.name }));
}

/**
 * Languages a business category can actually serve, strictly derived from the
 * distinct `language` values on its ACTIVE templates — never a stale or
 * hand-entered `category.languages` list. Returns `[]` when the category has
 * no active templates so callers can fall back gracefully. Drives the
 * customer-side language selector so it only ever offers languages that have
 * templates behind them.
 */
export async function getReviewLanguageOptions(categoryKey: string): Promise<string[]> {
  const { default: ReviewTemplate } = await import('@/models/ReviewTemplate');
  const key = (categoryKey ?? '').trim().toLowerCase();
  if (!key) return [];
  const rows = (await ReviewTemplate.distinct('language', {
    categoryKey: key,
    active: true,
  }).exec()) as string[];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const lang = String(raw).trim();
    if (lang && !seen.has(lang)) {
      seen.add(lang);
      out.push(lang);
    }
  }
  return out;
}

/**
 * Recompute `languages` on categories from the distinct `language` values of
 * their active templates, so stored category data always matches what the
 * library can actually serve (objective: category languages auto-follow the
 * templates). Only categories that have active template rows are updated;
 * zero-template categories keep their stored list — the customer page already
 * falls back to configured languages before ever showing an empty selector.
 * Best-effort: a sync failure must never fail an import/upsert.
 */
export async function syncCategoryLanguages(categoryKeys: string[]): Promise<void> {
  const keys = Array.from(
    new Set((categoryKeys ?? []).map((k) => (k ?? '').trim().toLowerCase()).filter((k) => k.length > 0))
  );
  if (keys.length === 0) return;
  const { default: ReviewCategory } = await import('@/models/ReviewCategory');
  const { default: ReviewTemplate } = await import('@/models/ReviewTemplate');
  const rows = (await ReviewTemplate.aggregate([
    { $match: { categoryKey: { $in: keys }, active: true } },
    { $group: { _id: '$categoryKey', languages: { $addToSet: '$language' } } },
  ]).exec()) as Array<{ _id: string; languages: string[] }>;

  const ops: Array<{
    updateOne: { filter: { key: string }; update: { $set: { languages: string[] } }; upsert: false };
  }> = [];
  for (const row of rows) {
    const languages = Array.from(
      new Set((row.languages ?? []).map((l) => String(l).trim()).filter((l) => l.length > 0))
    );
    if (languages.length === 0) continue;
    ops.push({ updateOne: { filter: { key: row._id }, update: { $set: { languages } }, upsert: false } });
  }
  if (ops.length === 0) return;
  try {
    await ReviewCategory.bulkWrite(ops, { ordered: false });
  } catch {
    /* best-effort — reads derive from templates anyway */
  }
}