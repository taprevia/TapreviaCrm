import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { fail, ok, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { canUseReviewAssistantForCard } from '@/lib/services/review-entitlement';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { logPublicCardAction } from '@/lib/analytics';
import { reviewPreferredLengthSchema } from '@/lib/validation/card';
import { getOrCreateRotationState } from '@/lib/services/review-rotation';
import { REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import { issueRotationToken } from '@/lib/services/review-rotation-token';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

const SUGGESTIONS_WINDOW_MS = 60_000;
const SUGGESTIONS_LIMIT = 30;
// Session repetition-control cap — larger than the client's history window so
// legit client lists always fit, while a single request can never explode.
const MAX_EXCLUDE_TEMPLATE_IDS = 16;

const suggestionsBodySchema = z.object({
  topics: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  feedback: z.string().trim().min(1).max(2000).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  length: reviewPreferredLengthSchema.optional(),
  // Session repetition control: template ids recently shown to this visitor.
  // Pure selection preference — validated as Mongo ObjectIds, capped, and only
  // used to filter candidate templates. Never an authorization mechanism.
  excludeTemplateIds: z
    .array(z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Invalid template id'))
    .max(MAX_EXCLUDE_TEMPLATE_IDS)
    .optional(),
  // Initial-load marker — metadata-only analytics, never persisted with text.
  init: z.boolean().optional(),
});

// POST /api/public/reviews/[alias]/suggestions
// Category-driven template mode — makes zero OpenAI calls and never persists
// review text. Guards mirror the AI generate route: card live + review
// assistant enabled + the review_ai_suggestions capability. When no category
// or no eligible templates exist, the client falls back to the AI flow.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);

    const limit = await check(`review-suggestions:${ip}`, SUGGESTIONS_LIMIT, SUGGESTIONS_WINDOW_MS);
    const limited = rateLimitFailure(limit, 'Too many requests — try again shortly');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = suggestionsBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    // Product-aware capability + effective settings. While the central public
    // integration gate is OFF, the effective settings are exactly legacy.
    const [entitled, effective] = await Promise.all([
      canUseReviewAssistantForCard(card),
      resolveEffectiveReviewSettings(card),
    ]);
    if (!entitled || !effective.enabled) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const ownerId = (card.userId ?? card.assignedUserId) ?? null;
    if (!ownerId) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const language = parsed.data.language;
    const length = parsed.data.length;
    const categoryKey = (effective.category ?? '').trim().toLowerCase();

    // Rotation state is read before selection so templates already copied in
    // the active cycle are excluded from the candidate pool (never merely
    // filtered after ranking). Strict server-side exclusions are only supplied
    // while the feature gate is enabled; the disabled contract is unchanged.
    const rotationState =
      REVIEW_ROTATION_ACTIVE && categoryKey
        ? await getOrCreateRotationState(ownerId, categoryKey)
        : null;

    const suggestions = await getReviewTemplateSuggestions({
      card: { name: card.name, reviewAssistant: effective },
      language,
      length,
      topics: parsed.data.topics,
      feedback: parsed.data.feedback,
      excludeTemplateIds: parsed.data.excludeTemplateIds,
      hardExcludeTemplateIds: rotationState?.usedTemplateIds,
    });

    if (suggestions.length === 0) {
      return ok({ mode: 'none', suggestions });
    }

    // Rotation-enabled responses carry a signed cycle reference so a delayed
    // copy from an older cycle cannot consume a template in a newer cycle.
    // Disabled by default; shape is unchanged while the gate is off.
    const responseSuggestions =
      rotationState && REVIEW_ROTATION_ACTIVE
        ? suggestions.map((suggestion) => ({
            ...suggestion,
            rotationToken: issueRotationToken({
              businessId: String(ownerId),
              categoryKey,
              templateId: suggestion.templateId,
              cycle: rotationState.cycle,
            }),
          }))
        : suggestions;

    // Privacy-conscious: metadata carries tuning/count only — never template
    // or review text. Backward compatible: this action is additive. The init
    // flag marks the initial-load request; it appears only when suggestions
    // were actually served (the none-case logs nothing, unchanged).
    await logPublicCardAction(
      card._id,
      'review_suggestions_shown',
      JSON.stringify({
        count: suggestions.length,
        language: language ?? effective.languages[0] ?? 'English',
        length: length ?? effective.preferredLength ?? 'medium',
        ...(parsed.data.init === true ? { init: true } : {}),
      }),
      request.headers
    ).catch((err) => {
      // Telemetry must never break a served suggestion, but it must be visible:
      // a connection race here is a real signal about DB health on serverless.
      console.error('[review-suggestions] analytics write failed:', err);
    });

    return ok({ mode: 'template', suggestions: responseSuggestions });
  } catch (error) {
    // Distinguish "we have nothing to suggest" from "we broke". The client
    // treats a non-`template` mode identically either way, so returning a real
    // 503 is backward-compatible for visitors while making outages visible in
    // Vercel logs, error tracking and uptime monitors instead of being
    // swallowed into a cheerful empty state.
    console.error('Review suggestions POST error:', error);
    return fail(503, 'INTERNAL_ERROR', 'Suggestions are temporarily unavailable');
  }
}