import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import {
  REVIEW_SETTINGS_MAX_BODY_BYTES,
  hasDangerousObjectKeys,
  reviewProductConnectionSchema,
} from '@/lib/validation/review-settings';
import { connectReviewProduct } from '@/lib/services/review-product-connection';
import { getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import { emitReviewEvent } from '@/lib/services/review-observability';

export const dynamic = 'force-dynamic';

type Params = { params: { assignmentId: string } };

/** PATCH /api/review-management/products/[assignmentId] — explicit source connection. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireApiEntitlement(request, 'review_ai_suggestions');
    if (auth.status === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (auth.status === 403) {
      return fail(403, 'FORBIDDEN', 'Review Management is not included in your products');
    }

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > REVIEW_SETTINGS_MAX_BODY_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Product connection payload is too large');
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > REVIEW_SETTINGS_MAX_BODY_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Product connection payload is too large');
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Invalid JSON payload');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid product connection payload');
    }
    if (hasDangerousObjectKeys(body)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid product connection payload');
    }

    await connectDB();
    const existingLookup = await getReviewProductForUser(auth.user._id, params.assignmentId);
    if (existingLookup.ok) {
      const incomingOverrides = (body as { overrides?: { googleReviewUrl?: unknown } })
        .overrides;
      const storedUrl = existingLookup.product.reviewOverrides.googleReviewUrl;
      if (
        incomingOverrides &&
        typeof incomingOverrides.googleReviewUrl === 'string' &&
        storedUrl &&
        incomingOverrides.googleReviewUrl === storedUrl
      ) {
        delete incomingOverrides.googleReviewUrl;
      }
    }

    const parsed = reviewProductConnectionSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid product connection', parsed.error.flatten().fieldErrors);
    }

    const result = await connectReviewProduct({
      userId: auth.user._id,
      assignmentId: params.assignmentId,
      input: parsed.data,
    });

    if (!result.ok) {
      if (result.status === 404) return fail(404, 'NOT_FOUND', result.message);
      if (result.status === 403) {
        emitReviewEvent({
          event: 'review.security.tenant_boundary_denied',
          tenantId: auth.user._id,
          errorCategory: 'tenant_boundary',
          reasonCategory: 'product_assignment',
        });
        return fail(403, 'FORBIDDEN', result.message);
      }
      if (result.status === 409) return fail(409, 'CONFLICT', result.message);
      return fail(400, 'VALIDATION_ERROR', result.message);
    }

    return ok({
      success: true,
      source: result.source,
      revision: result.revision,
      effective: result.effective,
    });
  } catch (error) {
    console.error('Review management product connection PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
