import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { fail, ok } from '@/lib/api';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';
import { MAX_IMAGE_BYTES, MAX_OTHER_BYTES } from '@/lib/media/gate';

/**
 * Step 3 of the presign flow: the client has PUT the object to the store.
 * Flip the reserved Media row from 'pending' → 'ready' with the real byte
 * count and (for images) processed dimensions.
 *
 * The client-declared payload is never trusted: the object store is re-checked
 * (HEAD) and the authoritative size/content-type are read back BEFORE the row
 * is marked ready, so a direct PUT that exceeds the category cap or carries a
 * mismatched content type cannot be confirmed. A failed check removes the
 * reserved row and the stray object so nothing is orphaned.
 */

const confirmSchema = z.object({
  key: z.string().min(1).max(200),
  bytes: z.number().int().positive().max(50 * 1024 * 1024),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include profile editing');

    const body = await request.json().catch(() => null);
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid confirm payload');
    }
    const { key, width, height } = parsed.data;

    await connectDB();

    const media = await Media.findOne({ key, status: 'pending' });
    if (!media || media.userId.toString() !== user._id) {
      return fail(404, 'NOT_FOUND', 'Not found');
    }

    // Independent verification of the stored object before committing.
    const head = await getStorage().headObject(key);
    if (!head) {
      // Object never landed in the store — drop the reserved row (TTL would
      // purge it anyway) and tell the client to restart the upload.
      await media.deleteOne();
      return fail(410, 'GONE', 'Upload did not reach storage — please retry');
    }

    const cap = media.category === 'other' ? MAX_OTHER_BYTES : MAX_IMAGE_BYTES;
    if (head.size === 0 || head.size > cap) {
      await bestEffortCleanup(key, media);
      return fail(400, 'VALIDATION_ERROR', 'File too large');
    }

    // The presigned PUT URL is content-type-locked by signature, but verify
    // what the store actually recorded anyway (case-insensitive per RFC 9110).
    if (
      head.contentType &&
      head.contentType.trim().toLowerCase() !== media.mime.toLowerCase()
    ) {
      await bestEffortCleanup(key, media);
      return fail(400, 'VALIDATION_ERROR', 'Content type mismatch');
    }

    media.status = 'ready';
    media.bytes = head.size; // authoritative — never the client-declared value
    if (width !== undefined) media.width = width;
    if (height !== undefined) media.height = height;
    await media.save();

    return ok({
      url: `/media/${key}`,
      key,
      bytes: head.size,
      width,
      height,
      mime: media.mime,
    });
  } catch (error) {
    console.error('Uploads confirm POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** Remove a stray object + reserved row when confirm validation fails. */
async function bestEffortCleanup(key: string, media: {
  deleteOne(): Promise<unknown>;
}): Promise<void> {
  try {
    await getStorage().deleteObject(key);
  } catch (err) {
    console.error(`Storage delete failed for key=${key}:`, err);
  }
  try {
    await media.deleteOne();
  } catch (err) {
    console.error(`Media row cleanup failed for key=${key}:`, err);
  }
}