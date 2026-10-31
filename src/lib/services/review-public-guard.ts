import { fail } from '@/lib/api';
import {
  REVIEW_SETTINGS_MAX_BODY_BYTES,
  hasDangerousObjectKeys,
} from '@/lib/validation/review-settings';

export type SafeReviewBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: Response };

/**
 * Shared JSON guard for public review writes (Standee host, Phase 4D.6).
 *
 * Public review endpoints accept a small JSON object. Reject oversized bodies,
 * malformed JSON, non-object payloads and prototype-pollution keys before any
 * service or database work.
 */
export async function readSafeReviewBody(
  request: Request
): Promise<SafeReviewBodyResult> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > REVIEW_SETTINGS_MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'PAYLOAD_TOO_LARGE', 'Payload is too large') };
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > REVIEW_SETTINGS_MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'PAYLOAD_TOO_LARGE', 'Payload is too large') };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, response: fail(400, 'VALIDATION_ERROR', 'Invalid JSON payload') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, response: fail(400, 'VALIDATION_ERROR', 'Invalid payload') };
  }
  if (hasDangerousObjectKeys(body)) {
    return { ok: false, response: fail(400, 'VALIDATION_ERROR', 'Invalid payload') };
  }
  return { ok: true, body };
}
