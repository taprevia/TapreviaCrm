import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import { fail, ok, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { readSafeReviewBody } from '@/lib/services/review-public-guard';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { getReviewTemplateSuggestions } from '@/lib/services/review-templates';
import { getOrCreateRotationState } from '@/lib/services/review-rotation';
import { REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import { issueRotationToken } from '@/lib/services/review-rotation-token';
import { reviewPreferredLengthSchema } from '@/lib/validation/card';
import AnalyticsLog from '@/models/AnalyticsLog';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

const WINDOW_MS = 60_000;
const LIMIT = 30;
const MAX_EXCLUDE_TEMPLATE_IDS = 16;

const bodySchema = z.object({
  topics: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  feedback: z.string().trim().min(1).max(2000).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  length: reviewPreferredLengthSchema.optional(),
  excludeTemplateIds: z
    .array(z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Invalid template id'))
    .max(MAX_EXCLUDE_TEMPLATE_IDS)
    .optional(),
  init: z.boolean().optional(),
});

/** POST /api/public/standee-reviews/[slug]/suggestions */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limited = rateLimitFailure(
      await check(`standee-review-suggestions:${ip}`, LIMIT, WINDOW_MS),
      'Too many requests — try again shortly'
    );
    if (limited) return limited;

    const safe = await readSafeReviewBody(request);
    if (!safe.ok) return safe.response;
    const parsed = bodySchema.safeParse(safe.body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();
    const host = await resolveStandeeReviewHost(params.slug);
    if (!host) return fail(404, 'NOT_FOUND', 'Review assistant is not available');

    const categoryKey = (host.config.category ?? '').trim().toLowerCase();
    const rotationState =
      REVIEW_ROTATION_ACTIVE && categoryKey
        ? await getOrCreateRotationState(host.ownerId, categoryKey)
        : null;

    const suggestions = await getReviewTemplateSuggestions({
      card: { name: host.businessName, reviewAssistant: host.config },
      language: parsed.data.language,
      length: parsed.data.length,
      topics: parsed.data.topics,
      feedback: parsed.data.feedback,
      excludeTemplateIds: parsed.data.excludeTemplateIds,
      hardExcludeTemplateIds: rotationState?.usedTemplateIds,
    });

    if (suggestions.length === 0) {
      return ok({ mode: 'none', suggestions });
    }

    const responseSuggestions =
      rotationState && REVIEW_ROTATION_ACTIVE
        ? suggestions.map((suggestion) => ({
            ...suggestion,
            rotationToken: issueRotationToken({
              businessId: host.ownerId,
              categoryKey,
              templateId: suggestion.templateId,
              cycle: rotationState.cycle,
              hostType: 'standee',
              hostId: host.standeeId,
            }),
          }))
        : suggestions;

    await AnalyticsLog.create({
      action: 'review_suggestions_shown',
      standeeId: host.standeeId,
      metadata: JSON.stringify({
        count: suggestions.length,
        language: parsed.data.language ?? host.config.languages[0] ?? 'English',
        length: parsed.data.length ?? host.config.preferredLength ?? 'medium',
        ...(parsed.data.init === true ? { init: true } : {}),
      }),
    }).catch((error) => {
      console.error('[standee-review-suggestions] analytics write failed:', error);
    });

    return ok({ mode: 'template', suggestions: responseSuggestions });
  } catch (error) {
    console.error('Standee review suggestions POST error:', error);
    return fail(503, 'INTERNAL_ERROR', 'Suggestions are temporarily unavailable');
  }
}
