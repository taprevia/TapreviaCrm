import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/request-ip';
import { fail, ok, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { connectDB } from '@/lib/db';
import { readSafeReviewBody } from '@/lib/services/review-public-guard';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { generateLibrarySuggestion, generateReviewForHost, tenantHasAiConfiguration } from '@/lib/services/review-generate';
import { emitReviewEvent } from '@/lib/services/review-observability';
import { reviewPreferredLengthSchema } from '@/lib/validation/card';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: { slug: string } };

const WINDOW_MS = 60_000;
const LIMIT = 10;

const bodySchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(3, 'Add at least 3 characters about your experience.')
    .max(5000, 'Feedback is too long.'),
  topics: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  length: reviewPreferredLengthSchema.optional(),
});

/** POST /api/public/standee-reviews/[slug]/generate */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const userAgent = request.headers.get('user-agent') ?? '';
    const limited = rateLimitFailure(
      await check(`standee-review-generate:${ip}`, LIMIT, WINDOW_MS),
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

    const aiConfigured = await tenantHasAiConfiguration(host.ownerId);
    const result = aiConfigured
      ? await generateReviewForHost({
          ownerId: host.ownerId,
          hostType: 'standee',
          hostId: host.standeeId,
          config: {
            ...host.config,
            businessName: (host.config.businessName || host.businessName || '').trim(),
          },
          feedback: parsed.data.feedback,
          topics: parsed.data.topics ?? [],
          language: parsed.data.language,
          length: parsed.data.length,
          ip,
          userAgent,
        })
      : await generateLibrarySuggestion({
          businessName: host.businessName,
          config: host.config,
          feedback: parsed.data.feedback,
          topics: parsed.data.topics ?? [],
          language: parsed.data.language,
          length: parsed.data.length,
          tenantId: host.ownerId,
          hostType: 'standee',
        });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') return fail(404, 'NOT_FOUND', result.message);
      if (result.code === 'NO_MATCHING_REVIEW_TEMPLATE') return fail(404, 'NO_MATCHING_REVIEW_TEMPLATE', result.message);
      if (result.code === 'AI_NOT_CONFIGURED') return fail(503, 'AI_NOT_CONFIGURED', result.message);
      if (result.code === 'UNAVAILABLE') return fail(503, 'UNAVAILABLE', result.message);
      return fail(429, 'LIMIT_REACHED', result.message);
    }

    return ok({ review: result.review, engine: result.engine });
  } catch (error) {
    emitReviewEvent({ event: 'review.generation.failure', hostType: 'standee', outcome: 'failure', errorCategory: 'internal' });
    console.error('Standee review generate POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Could not generate a review draft');
  }
}
