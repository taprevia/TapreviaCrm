import { NextRequest } from 'next/server';
import { z } from 'zod';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import { fail, ok, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import ReviewTemplate from '@/models/ReviewTemplate';
import {
  getOrCreateRotationState,
  recordReviewCopy,
} from '@/lib/services/review-rotation';
import { REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import {
  issueRotationToken,
  rotationTokenMatchesHost,
  verifyRotationTokenDetailed,
} from '@/lib/services/review-rotation-token';
import { isTemplateEdibleForBusiness } from '@/lib/services/review-templates';
import { canUseReviewAssistantForCard } from '@/lib/services/review-entitlement';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

const COPIED_WINDOW_MS = 60_000;
const COPIED_LIMIT = 60;

const copiedBodySchema = z.object({
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

/**
 * POST /api/public/reviews/[alias]/copied
 *
 * Additive Phase 4A endpoint: records that a customer successfully copied a
 * template. It does not change suggestions, usageCount, lastShownAt, drafts or
 * public review UI. Business identity is resolved server-side from the card.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limit = await check(`review-copied:${ip}`, COPIED_LIMIT, COPIED_WINDOW_MS);
    const limited = rateLimitFailure(limit, 'Too many requests — try again shortly');
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const parsed = copiedBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const [entitled, effective] = await Promise.all([
      canUseReviewAssistantForCard(card),
      resolveEffectiveReviewSettings(card),
    ]);
    if (!entitled || !effective.enabled) {
      return fail(404, 'NOT_FOUND', 'Review assistant is not available');
    }

    const ownerId = (card.userId ?? card.assignedUserId) ?? null;
    if (!ownerId) return fail(404, 'NOT_FOUND', 'Review assistant is not available');

    const categoryKey = (effective.category ?? '').trim().toLowerCase();
    if (!categoryKey) return fail(404, 'NOT_FOUND', 'Review assistant is not available');

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
      businessName: (card.name ?? '').trim(),
      employees: (effective.employees ?? [])
        .map((v: unknown) => String(v).trim())
        .filter(Boolean),
      services: (effective.services ?? [])
        .map((v: unknown) => String(v).trim())
        .filter(Boolean),
      keywords: (effective.keywords ?? [])
        .map((v: unknown) => String(v).trim())
        .filter(Boolean),
    };
    if (!isTemplateEdibleForBusiness(template, values)) {
      return fail(400, 'VALIDATION_ERROR', 'Template is not available for this review assistant');
    }

    // Rotation validation applies only while the feature gate is enabled.
    // With the gate off, existing callers (no token) keep the Phase 4A
    // contract and an unexpected token is ignored rather than trusted.
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
        claims.businessId !== String(ownerId) ||
        claims.categoryKey !== categoryKey ||
        claims.templateId !== String(template._id) ||
        !rotationTokenMatchesHost(claims, 'card', String(card._id))
      ) {
        return fail(409, 'CONFLICT', 'Invalid or expired review cycle reference');
      }

      // Compare against the live cycle before refreshing an expired token so
      // a draft from an earlier cycle can never consume a newer-cycle template.
      const state = await getOrCreateRotationState(ownerId, categoryKey);
      if (
        claims.cycle !== state.cycle ||
        (parsed.data.cycle !== undefined && parsed.data.cycle !== claims.cycle)
      ) {
        return fail(409, 'CONFLICT', 'This review cycle has changed. Please request a new suggestion.');
      }

      if (verification.expired) {
        // Same-cycle refresh only. The client retries once with the same
        // copyId; idempotency prevents duplicate events.
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
      businessId: ownerId,
      categoryKey,
      templateId: template._id,
      copyId: parsed.data.copyId,
      cardId: card._id,
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
    console.error('Review copied POST error:', error);
    return fail(503, 'UNAVAILABLE', 'Could not record the review copy');
  }
}
