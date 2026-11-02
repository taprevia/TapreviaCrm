import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { fail, ok } from '@/lib/api';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import {
  REVIEW_SETTINGS_MAX_BODY_BYTES,
  hasDangerousObjectKeys,
  reviewSettingsPatchSchema,
} from '@/lib/validation/review-settings';
import {
  getSavedReviewSettings,
  saveReviewSettings,
} from '@/lib/services/review-management-settings';
import { getCentralIntegrationRollout } from '@/lib/services/review-rollout';
import TenantSettings from '@/models/TenantSettings';

export const dynamic = 'force-dynamic';

async function authorizedUser(request: NextRequest) {
  const result = await requireApiEntitlement(request, 'review_ai_suggestions');
  if (result.status === 401) {
    return { response: fail(401, 'UNAUTHORIZED', 'Unauthorized') };
  }
  if (result.status === 403) {
    return { response: fail(403, 'FORBIDDEN', 'Review Management is not included in your products') };
  }
  return { user: result.user };
}

// GET /api/review-management — saved settings or clearly marked unsaved defaults.
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizedUser(request);
    if (auth.response) return auth.response;

    await connectDB();
    const settings = await getSavedReviewSettings(auth.user!._id);
    const tenant = await TenantSettings.findOne({ userId: auth.user!._id })
      .select('openai.enabled openai.apiKeyEnc')
      .lean<{ openai?: { enabled?: boolean; apiKeyEnc?: string } } | null>();
    return ok({
      ...settings,
      publicIntegrationEnabled: getCentralIntegrationRollout(auth.user!._id).effective,
      aiConfigured: Boolean(tenant?.openai?.enabled && tenant.openai.apiKeyEnc),
    });
  } catch (error) {
    console.error('Review management GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// PATCH /api/review-management — controlled partial central settings update.
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizedUser(request);
    if (auth.response) return auth.response;

    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > REVIEW_SETTINGS_MAX_BODY_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Review settings payload is too large');
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > REVIEW_SETTINGS_MAX_BODY_BYTES) {
      return fail(413, 'PAYLOAD_TOO_LARGE', 'Review settings payload is too large');
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Invalid JSON payload');
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid review settings payload');
    }
    if (hasDangerousObjectKeys(body)) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid review settings payload');
    }

    await connectDB();
    const record = body as Record<string, unknown>;
    const incomingGeneral = record.general as Record<string, unknown> | undefined;
    const stored = await getSavedReviewSettings(auth.user!._id);
    if (
      incomingGeneral &&
      typeof incomingGeneral.googleReviewUrl === 'string' &&
      stored.saved &&
      incomingGeneral.googleReviewUrl === stored.settings.general.googleReviewUrl
    ) {
      delete incomingGeneral.googleReviewUrl;
      if (Object.keys(incomingGeneral).length === 0) delete record.general;
      // An unchanged legacy URL is a no-op; return the stored settings rather
      // than rejecting a form that only resubmitted existing values.
      if (!record.general && !record.content) return ok(stored);
    }

    const parsed = reviewSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid review settings', parsed.error.flatten().fieldErrors);
    }

    const expectedRevision =
      parsed.data.revision === undefined ? undefined : String(parsed.data.revision);
    const saved = await saveReviewSettings(
      auth.user!._id,
      auth.user!._id,
      parsed.data,
      expectedRevision
    );
    if (!saved.ok) {
      if (saved.status === 409) {
        return fail(409, 'CONFLICT', saved.message, saved.details);
      }
      return fail(400, 'VALIDATION_ERROR', saved.message, saved.details);
    }

    const tenant = await TenantSettings.findOne({ userId: auth.user!._id })
      .select('openai.enabled openai.apiKeyEnc')
      .lean<{ openai?: { enabled?: boolean; apiKeyEnc?: string } } | null>();
    return ok({
      ...saved.saved,
      publicIntegrationEnabled: getCentralIntegrationRollout(auth.user!._id).effective,
      aiConfigured: Boolean(tenant?.openai?.enabled && tenant.openai.apiKeyEnc),
    });
  } catch (error) {
    console.error('Review management PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
