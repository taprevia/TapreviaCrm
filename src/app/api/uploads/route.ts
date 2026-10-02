import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { fail, ok, parsePagination } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { mediaCategorySchema, uploadMetaSchema } from '@/lib/validation/media';
import { objectIdSchema } from '@/lib/validation/common';
import Card from '@/models/Card';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';
import {
  AVATAR_SIZE,
  IMAGE_EXTS,
  IMAGE_FORMATS,
  IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_WIDTH,
  MAX_OTHER_BYTES,
  OTHER_TYPES,
  fileExt,
  utcYearMonth,
} from '@/lib/media/gate';

export const dynamic = 'force-dynamic';

// ─── POST /api/uploads — multipart upload → processed media ──────────────────
// This buffered path is the local/dev fallback; production first tries the
// presign/direct flow (/api/uploads/presign + confirm) to dodge the
// serverless request-body cap.

function unsupported() {
  return fail(400, 'VALIDATION_ERROR', 'Unsupported file type');
}

function tooLarge() {
  return fail(400, 'VALIDATION_ERROR', 'File too large');
}

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

    // ── Parse multipart body & metadata ──
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'VALIDATION_ERROR', 'Invalid multipart form data');
    }

    const fileEntry = form.get('file');
    if (!(fileEntry instanceof File)) {
      return fail(400, 'VALIDATION_ERROR', 'File is required');
    }
    const file = fileEntry;

    const categoryRaw = form.get('category');
    const cardIdRaw = form.get('cardId');
    const metaParsed = uploadMetaSchema.safeParse({
      category: typeof categoryRaw === 'string' ? categoryRaw : undefined,
      ...(typeof cardIdRaw === 'string' && cardIdRaw !== '' ? { cardId: cardIdRaw } : {}),
    });
    if (!metaParsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid upload metadata', metaParsed.error.flatten().fieldErrors);
    }
    const { category, cardId } = metaParsed.data;

    await connectDB();

    // ── Card ownership ──
    if (cardId) {
      const card = await Card.findById(cardId).select('userId');
      if (!card || card.userId.toString() !== user._id) {
        return fail(403, 'FORBIDDEN', 'Not your card');
      }
    }

    // ── Type gate + size caps BEFORE any processing ──
    if (file.size === 0) return unsupported();

    const ext = fileExt(file.name);
    const declaredImage = IMAGE_MIMES.has(file.type) || IMAGE_EXTS.has(ext);

    // category 'other' may carry a whitelisted document/video verbatim;
    // everything else is routed through the image pipeline.
    const isVerbatim =
      category === 'other' && !declaredImage && OTHER_TYPES[ext] === file.type;

    const cap = isVerbatim ? MAX_OTHER_BYTES : MAX_IMAGE_BYTES;
    if (file.size > cap) return tooLarge();

    const buffer = Buffer.from(await file.arrayBuffer());

    let outBuffer: Buffer;
    let width: number | undefined;
    let height: number | undefined;
    let mime: string;

    if (!isVerbatim) {
      // Sniff real bytes — the declared mime/extension is never trusted.
      let format: string | undefined;
      try {
        format = (await sharp(buffer).metadata()).format;
      } catch {
        return unsupported();
      }
      if (!format || !IMAGE_FORMATS.has(format)) return unsupported();

      // Process: strip EXIF/metadata, bake orientation into pixels.
      // avatar → 512x512 cover crop q82; everything else ≤1600w inside q80.
      const resized =
        category === 'avatar'
          ? sharp(buffer).rotate().resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
          : sharp(buffer).rotate().resize({
              width: MAX_IMAGE_WIDTH,
              fit: 'inside',
              withoutEnlargement: true,
            });

      const { data, info } = await resized
        .webp({ quality: category === 'avatar' ? 82 : 80 })
        .toBuffer({ resolveWithObject: true });

      outBuffer = data;
      width = info.width;
      height = info.height;
      mime = 'image/webp';
    } else {
      outBuffer = buffer;
      mime = OTHER_TYPES[ext];
    }

    // ── Key + persist ──
    const storedExt = isVerbatim ? ext : 'webp';
    const key = `${user._id}/${utcYearMonth()}/${randomUUID()}.${storedExt}`;

    await getStorage().putObject(key, outBuffer, mime);

    await Media.create({
      userId: user._id,
      ...(cardId ? { cardId } : {}),
      category,
      key,
      url: `/media/${key}`,
      bytes: outBuffer.length,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      mime,
    });

    return ok(
      { url: `/media/${key}`, key, bytes: outBuffer.length, width, height, mime },
      201
    );
  } catch (error) {
    console.error('Uploads POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// ─── GET /api/uploads — paginated media library for the authenticated user ───

export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include profile editing');

    await connectDB();
    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const filter: Record<string, unknown> = { userId: user._id };

    const categoryRaw = sp.get('category');
    if (categoryRaw) {
      const c = mediaCategorySchema.safeParse(categoryRaw);
      if (!c.success) return fail(400, 'VALIDATION_ERROR', 'Invalid category filter');
      filter.category = c.data;
    }

    const cardIdRaw = sp.get('cardId');
    if (cardIdRaw) {
      const v = objectIdSchema.safeParse(cardIdRaw);
      if (!v.success) return fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter');
      filter.cardId = v.data;
    }

    // Prefix match on mime (e.g. mime=image/ → all images). Escape the value;
    // only sane mime characters are allowed before building the regex.
    const mimeRaw = sp.get('mime')?.trim();
    if (mimeRaw) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9!#$&^_.+-]*\/[a-zA-Z0-9!#$&^_.+-]*$/.test(mimeRaw)) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid mime filter');
      }
      filter.mime = { $regex: `^${mimeRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
    }

    const [docs, total] = await Promise.all([
      Media.find(filter)
        .select('_id url key category bytes width height mime createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Media.countDocuments(filter),
    ]);

    return ok({
      items: docs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Uploads GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// ─── DELETE /api/uploads?key=… — remove owned media ──────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include profile editing');

    const key = new URL(request.url).searchParams.get('key');
    if (!key) return fail(400, 'VALIDATION_ERROR', 'Missing key parameter');

    await connectDB();

    const media = await Media.findOne({ key });
    if (!media) return fail(404, 'NOT_FOUND', 'Not found');

    if (user.role !== 'admin' && media.userId.toString() !== user._id) {
      return fail(403, 'FORBIDDEN', 'Not your media');
    }

    // Best-effort storage delete — meta deletion must not be blocked by it.
    try {
      await getStorage().deleteObject(key);
    } catch (storageErr) {
      console.error(`Storage delete failed for key=${key}:`, storageErr);
    }

    await media.deleteOne();

    return ok({ success: true });
  } catch (error) {
    console.error('Uploads DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
