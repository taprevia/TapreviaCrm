import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import { fail, ok, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { readSafeReviewBody } from '@/lib/services/review-public-guard';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import ReviewTemplate from '@/models/ReviewTemplate';
import { getOrCreateRotationState, recordReviewCopy } from '@/lib/services/review-rotation';
import { REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import {
  issueRotationToken,
  rotationTokenMatchesHost,
  verifyRotationTokenDetailed,
} from '@/lib/services/review-rotation-token';
import { isTemplateEdibleForBusiness } from '@/lib/services/review-templates';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

const WINDOW_MS = 60_000;
const LIMIT = 60;

const bodySchema = z.object({
  templateId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, 'Invalid template id'),
  copyId: z
    .string()
    .trim()
    .min(8, 'Invalid copy id')
    .max(100, 'Invalid copy id')
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid copy id'),
  cycle: z.number().int().min(0).max(1_000_000).optional(),
  rotationToken: z.string().trim().max(2048).optional(),
});

/** POST /api/public/standee-reviews/[slug]/copied */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limited = rateLimitFailure(
      await check(`standee-review-copied:${ip}`, LIMIT, WINDOW_MS),
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
    if (!categoryKey) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const template = await ReviewTemplate.findOne({
      _id: parsed.data.templateId,
      categoryKey,
      active: true,
    })
      .select('_id categoryKey text compatibleKeywords')
      .lean<{
        _id: unknown;
        categoryKey: string;
        text: string;
        compatibleKeywords?: string[];
      } | null>();
    if (!template) {
      return fail(400, 'VALIDATION_ERROR', 'Template is not available for this review assistant');
    }

    const values = {
      businessName: host.businessName.trim(),
      employees: (host.config.employees ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean),
      services: (host.config.services ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean),
      keywords: (host.config.keywords ?? [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    };
    if (!isTemplateEdibleForBusiness(template, values)) {
      return fail(400, 'VALIDATION_ERROR', 'Template is not available for this review assistant');
    }

    let tokenCycle: number | undefined;
    if (REVIEW_ROTATION_ACTIVE) {
      const rawToken = parsed.data.rotationToken;
      if (!rawToken) {
        return fail(409, 'CONFLICT', 'A valid review cycle reference is required');
      }
      const verification = verifyRotationTokenDetailed(rawToken);
      const claims = verification.claims;
      if (
        !claims ||
        claims.businessId !== host.ownerId ||
        claims.categoryKey !== categoryKey ||
        claims.templateId !== String(template._id) ||
        !rotationTokenMatchesHost(claims, 'standee', host.standeeId)
      ) {
        return fail(409, 'CONFLICT', 'Invalid or expired review cycle reference');
      }

      const state = await getOrCreateRotationState(host.ownerId, categoryKey);
      if (
        claims.cycle !== state.cycle ||
        (parsed.data.cycle !== undefined && parsed.data.cycle !== claims.cycle)
      ) {
        return fail(409, 'CONFLICT', 'This review cycle has changed. Please request a new suggestion.');
      }

      if (verification.expired) {
        return fail(
          409,
          'CONFLICT',
          'Your review session refreshed — please tap the copy button again.',
          { reason: 'TOKEN_EXPIRED', rotationToken: issueRotationToken(claims) }
        );
      }
      tokenCycle = claims.cycle;
    }

    const result = await recordReviewCopy({
      businessId: host.ownerId,
      categoryKey,
      templateId: template._id,
      copyId: parsed.data.copyId,
      cardId: null,
      standeeId: host.standeeId,
      values,
      cycle: tokenCycle ?? parsed.data.cycle,
    });

    if (result.stale) {
      return fail(409, 'CONFLICT', 'This review cycle has changed. Please request a new suggestion.');
    }

    return ok(
      {
        success: true,
        recorded: result.recorded,
        duplicate: result.duplicate,
        cycle: result.cycle,
        rolledOver: result.rolledOver,
      },
      result.duplicate ? 200 : 201
    );
  } catch (error) {
    console.error('Standee review copied POST error:', error);
    return fail(503, 'UNAVAILABLE', 'Could not record the review copy');
  }
}
