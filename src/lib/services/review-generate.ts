import { connectDB } from '@/lib/db';
import { check } from '@/lib/rate-limit';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { hasCapability } from '@/lib/services/capability-access';
import TenantSettings, { DEFAULT_AI_GENERATION_DAILY_LIMIT } from '@/models/TenantSettings';
import AnalyticsLog from '@/models/AnalyticsLog';
import { decryptSecret } from '@/lib/crypto';
import { chatCompletion, type ChatCompletionInput, type ChatCompletionResult } from '@/lib/openai';
import type { ReviewPreferredLength } from '@/types';

/**
 * AI review-generation orchestration with tenant cost-control.
 *
 * Order of operations (cheapest guards first):
 *   1. Card available + review assistant enabled.
 *   2. Tenant OpenAI enabled + key present (kill-switch).
 *   3. Per-alias short-term burst limit (in-process window).
 *   4. Atomic per-tenant daily reservation (`$inc` on a Map key). The check is
 *      the post-increment value, so concurrent visitors cannot overspend — the
 *      k-th serialized reservation sees count k and only the first `limit`
 *      succeed. Failed/slow completions still consume their reservation
 *      (deliberately conservative: budget prevents cost, not quality).
 *   5. Decrypt key, single-turn completion, log usage metadata only.
 *
 * Customer feedback and generated review text are never logged.
 */

const REVIEW_GENERATE_ALIAS_LIMIT = 60;
const REVIEW_GENERATE_ALIAS_WINDOW_MS = 60 * 60 * 1000;

export type ReviewGenerateResult =
  | { ok: true; review: string }
  | { ok: false; code: 'NOT_FOUND' | 'UNAVAILABLE' | 'LIMIT_REACHED'; message: string };

/** Test seam: the real OpenAI call, injectable for deterministic verification. */
export type CompletionFn = (input: ChatCompletionInput) => Promise<ChatCompletionResult>;

export interface GenerateReviewInput {
  alias: string;
  feedback: string;
  topics: string[];
  language?: string;
  length?: ReviewPreferredLength;
  ip: string;
  userAgent: string;
  complet?: CompletionFn;
}

const STYLE_LABELS = {
  friendly: 'friendly and warm',
  professional: 'professional and polished',
  casual: 'casual and conversational',
  simple: 'simple and plain',
} as const;

const LENGTH_LABELS = {
  short: 'short (2-3 sentences)',
  medium: 'medium (4-6 sentences)',
  detailed: 'detailed (7-10 sentences)',
} as const;

function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function generateReviewSuggestion(
  input: GenerateReviewInput
): Promise<ReviewGenerateResult> {
  const { alias, feedback, topics, language, length, ip, userAgent } = input;
  const complet: CompletionFn = input.complet ?? chatCompletion;

  await connectDB();
  const card = await getPublicCardByAlias(alias);
  if (!card || !card.reviewAssistant?.enabled) {
    return { ok: false, code: 'NOT_FOUND', message: 'Review assistant is not available' };
  }

  // Capability gate: AI Review Assistant must be included in the card
  // owner's purchased products. Neutral 404 — never hints at entitlement.
  // Owner identity uses `userId ?? assignedUserId` to match the page + template
  // endpoints (a card bound to a physical holder still resolves its plan).
  const ownerId = (card.userId ?? card.assignedUserId) ?? null;
  const allowed = await hasCapability(ownerId, 'review_ai_suggestions');
  if (!allowed) {
    return { ok: false, code: 'NOT_FOUND', message: 'Review assistant is not available' };
  }

  const config = card.reviewAssistant;

  const settings = await TenantSettings.findOne({ userId: card.userId }).lean<{
    openai?: { enabled?: boolean; apiKeyEnc?: string; model?: string; dailyLimit?: number };
  } | null>();
  const openai = settings?.openai;
  if (!openai?.enabled || !openai.apiKeyEnc) {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'The AI review-writing service for this business is currently unavailable.',
    };
  }

  // Per-alias secondary limit — one printed QR/link cannot burn the tenant budget.
  const aliasLimit = await check(`review-generate-alias:${card._id}`, REVIEW_GENERATE_ALIAS_LIMIT, REVIEW_GENERATE_ALIAS_WINDOW_MS);
  if (!aliasLimit.success) {
    return {
      ok: false,
      code: 'LIMIT_REACHED',
      message: 'The review-writing service is busy right now — please try again shortly.',
    };
  }

  // Atomic per-tenant daily reservation. `openai.usage[YYYY-MM-DD]` is a Map key
  // incremented server-side; the returned post-increment value is the authority.
  const today = utcDayKey();
  const daily = openai.dailyLimit ?? DEFAULT_AI_GENERATION_DAILY_LIMIT;
  if (daily > 0) {
    const reserved = await TenantSettings.findOneAndUpdate(
      { userId: card.userId },
      { $inc: { [`openai.usage.${today}`]: 1 }, $setOnInsert: { userId: card.userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const used = Number(reserved?.openai.usage?.get?.(today) ?? 0);
    if (used > daily) {
      return {
        ok: false,
        code: 'LIMIT_REACHED',
        message:
          "This business has used up today's review-writing allowance. You can still write and post your own review.",
      };
    }
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(openai.apiKeyEnc);
  } catch {
    return {
      ok: false,
      code: 'UNAVAILABLE',
      message: 'The AI review-writing service for this business is currently unavailable.',
    };
  }

  const lang = language ?? config.languages?.[0] ?? 'English';
  const len = length ?? config.preferredLength ?? 'medium';
  const style = config.writingStyle ?? 'friendly';

  const topicsLine =
    topics.length > 0 ? topics.map((t: string) => `- ${t}`).join('\n') : '(none selected)';

  const system = [
    'You are a writing assistant inside a Google-review flow. A customer has already decided to leave a review and uses you only to phrase their own experience more naturally.',
    'Hard rules:',
    '1. Rewrite ONLY the details the customer actually supplied. Never invent businesses, products, staff names, prices, ratings, or experiences.',
    '2. The listed feedback topics are optional context about what the customer may have mentioned — treat them as hints, never as facts.',
    '3. Never produce or imply a star rating or review score.',
    '4. Do not add positive sentiment the customer did not express; do not remove criticism. Stay truthful to their words.',
    '5. If a language is specified, reply entirely in that language; otherwise match the language of the customer\u2019s own words.',
    `6. Match this writing style: ${STYLE_LABELS[style as keyof typeof STYLE_LABELS] ?? 'friendly'}.`,
    `7. Match this length: ${LENGTH_LABELS[len as keyof typeof LENGTH_LABELS] ?? 'medium'}.`,
    '8. Output only the finished review as concise plain text. No preamble, headings, quotes, or commentary.',
  ].join('\n');

  const userMsg = [
    'Customer-selected language (reply in it):',
    lang,
    '',
    'Feedback topics as context only:',
    topicsLine,
    '',
    'The customer\u2019s own words:',
    `"""\n${feedback}\n"""`,
  ].join('\n');

  const result = await complet({
    apiKey,
    model: openai.model || 'gpt-4o-mini',
    system,
    user: userMsg,
  });

  // Fire-and-forget, privacy-conscious: metadata carries tuning + token usage
  // only — never the customer's feedback or the generated review text.
  await AnalyticsLog.create({
    cardId: card._id,
    action: 'review_generated',
    metadata: JSON.stringify({
      length: len,
      style,
      language: lang,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
    }),
    ip,
    userAgent,
  });

  return { ok: true, review: result.text };
}