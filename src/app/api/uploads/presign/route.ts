import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { fail, ok } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { uploadMetaSchema } from '@/lib/validation/media';
import Card from '@/models/Card';
import Media from '@/models/Media';
import { classifyUpload, utcYearMonth } from '@/lib/media/gate';
import { getStorage } from '@/lib/storage';

/**
 * Presign flow (serverless-safe):
 *   1. POST /api/uploads/presign { category, cardId?, file:{name,size,type} }
 *      → { mode:'direct', uploadUrl, key, headers } | { mode:'proxy' }
 *   2. mode 'direct': client PUTs the (already processed) bytes straight to
 *      the object store — bypasses the ~4.5MB serverless request-body cap.
 *   3. POST /api/uploads/confirm { key, bytes, width?, height? } → Media row
 *      becomes 'ready' and is served by /media/[...key].
 *
 * In 'proxy' mode (local driver), clients fall back to the legacy buffered
 * multipart POST /api/uploads exactly as before.
 */

const fileFieldSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(100),
});

const presignBodySchema = uploadMetaSchema.extend({
  file: fileFieldSchema,
});

export async function POST(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include profile editing');

    const limit = await check(`upload:${user._id}`, 30, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many uploads');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = presignBodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid upload metadata', parsed.error.flatten().fieldErrors);
    }
    const { category, cardId, file } = parsed.data;

    // ── Classify + size-gate before any presign ──
    let cls;
    try {
      cls = classifyUpload(category, file.name, file.type);
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Unsupported file type');
    }
    if (file.size === 0 || file.size > cls.cap) {
      return fail(400, 'VALIDATION_ERROR', 'File too large');
    }

    await connectDB();

    // ── Card ownership ──
    if (cardId) {
      const card = await Card.findById(cardId).select('userId');
      if (!card || card.userId.toString() !== user._id) {
        return fail(403, 'FORBIDDEN', 'Not your card');
      }
    }

    const storage = getStorage();
    const presignPut = storage.presignPutUrl;

    // Local driver has no presign — tell the client to use multipart upload.
    if (!presignPut) {
      return ok({ mode: 'proxy' });
    }

    const key = `${user._id}/${utcYearMonth()}/${randomUUID()}.${cls.storedExt}`;
    const uploadUrl = await presignPut.call(storage, key, cls.mime);

    // Reserve the Media row now; orphaned 'pending' rows are TTL-purged.
    await Media.create({
      userId: user._id,
      ...(cardId ? { cardId } : {}),
      category,
      key,
      url: `/media/${key}`,
      bytes: 0,
      ...(cls.kind === 'image' ? { width: 0 } : {}),
      ...(cls.kind === 'image' ? { height: 0 } : {}),
      mime: cls.mime,
      status: 'pending',
    });

    return ok({
      mode: 'direct',
      key,
      uploadUrl,
      headers: { 'Content-Type': cls.mime },
      kind: cls.kind,
    });
  } catch (error) {
    console.error('Uploads presign POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}