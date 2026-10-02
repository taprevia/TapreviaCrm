import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { z } from 'zod';
import { fail, ok } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { generateReviewSuggestion } from '@/lib/services/review-generate';
import { reviewPreferredLengthSchema } from '@/lib/validation/card';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

const GENERATE_WINDOW_MS = 60_000;
const GENERATE_LIMIT = 10;

const generateBodySchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(20, 'Tell us a little more about your experience.')
    .max(5000, 'Feedback is too long.'),
  topics: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  language: z.string().trim().min(1).max(40).optional(),
  length: reviewPreferredLengthSchema.optional(),
});

// POST /api/public/reviews/[alias]/generate
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const userAgent = request.headers.get('user-agent') ?? '';

    const limit = await check(`review-generate:${ip}`, GENERATE_LIMIT, GENERATE_WINDOW_MS);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests — try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = generateBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const result = await generateReviewSuggestion({
      alias: params.alias,
      feedback: parsed.data.feedback,
      topics: parsed.data.topics ?? [],
      language: parsed.data.language,
      length: parsed.data.length,
      ip,
      userAgent,
    });

    if (!result.ok) {
      if (result.code === 'NOT_FOUND') {
        return fail(404, 'NOT_FOUND', result.message);
      }
      if (result.code === 'UNAVAILABLE') {
        return fail(503, 'UNAVAILABLE', result.message);
      }
      return fail(429, 'LIMIT_REACHED', result.message);
    }

    return ok({ review: result.review });
  } catch (error) {
    console.error('Review generate POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Could not generate a review draft');
  }
}