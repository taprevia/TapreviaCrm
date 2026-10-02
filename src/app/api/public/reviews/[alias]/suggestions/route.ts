import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { hasCapability } from '@/lib/services/capability-access';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { logPublicCardAction } from '@/lib/analytics';
import { reviewPreferredLengthSchema } from '@/lib/validation/card';

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
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests — try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = suggestionsBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card || !card.reviewAssistant?.enabled) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    // Capability gate: mirror the AI path — neutral 404, never hinting at
    // entitlement. The existing feature/capability gate stays enforced. The
    // owner identity uses `userId ?? assignedUserId` so a card bound to a
    // physical holder still resolves to its entitlement — matching the page.
    const ownerId = (card.userId ?? card.assignedUserId) ?? null;
    const allowed = await hasCapability(ownerId, 'review_ai_suggestions');
    if (!allowed) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const language = parsed.data.language;
    const length = parsed.data.length;

    const suggestions = await getReviewTemplateSuggestions({
      card,
      language,
      length,
      topics: parsed.data.topics,
      feedback: parsed.data.feedback,
      excludeTemplateIds: parsed.data.excludeTemplateIds,
    });

    if (suggestions.length === 0) {
      return ok({ mode: 'none', suggestions });
    }

    // Privacy-conscious: metadata carries tuning/count only — never template
    // or review text. Backward compatible: this action is additive. The init
    // flag marks the initial-load request; it appears only when suggestions
    // were actually served (the none-case logs nothing, unchanged).
    await logPublicCardAction(
      card._id,
      'review_suggestions_shown',
      JSON.stringify({
        count: suggestions.length,
        language: language ?? card.reviewAssistant.languages?.[0] ?? 'English',
        length: length ?? card.reviewAssistant.preferredLength ?? 'medium',
        ...(parsed.data.init === true ? { init: true } : {}),
      }),
      request.headers
    ).catch(() => {});

    return ok({ mode: 'template', suggestions });
  } catch (error) {
    console.error('Review suggestions POST error:', error);
    return NextResponse.json({ ok: false, mode: 'none', suggestions: [] });
  }
}