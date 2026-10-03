import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import Media from '@/models/Media';
import { getStorage, driverName } from '@/lib/storage';

/**
 * Exact shape of a stored key:
 *   <24-hex userId>/<yyyy>-<mm>/<uuid>.<ext>
 * Doubles as a path-traversal guard — nothing outside this grammar ever
 * reaches storage.
 */
const MEDIA_KEY_RE =
  /^[0-9a-f]{24}\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(webp|png|jpg|jpeg|pdf|doc|docx|mp4)$/;

/**
 * 404 with a server-side breadcrumb. Every rejection reason is logged with the
 * key so a broken avatar is diagnosable from logs alone — previously all four
 * 404 paths were silent, which made "image not served" indistinguishable from
 * "image never requested".
 */
function notFound(key: string, reason: string): Response {
  console.warn(`Media 404 key=${key} driver=${driverName()} reason=${reason}`);
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * Emit a structured, greppable line for any storage-layer failure so the exact
 * network/auth fault is visible in Vercel logs.
 *
 * The SDK's `name` + `$metadata.httpStatusCode` are what actually classify the
 * failure (`AccessDenied` 403, `InvalidAccessKeyId` 403, `ExpiredToken` 403,
 * `SlowDown` 503, `NetworkingError` with no status) — and those details are
 * destroyed by the driver's normalisation to `Error('NOT_FOUND')`, so they are
 * read defensively here. Never logs credentials.
 */
function logStorageError(key: string, stage: string, err: unknown): void {
  const e = err as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { message?: string; code?: string };
    $metadata?: { httpStatusCode?: number };
    $response?: { statusCode?: number };
  };
  // When the driver normalized to Error('NOT_FOUND'), the discriminating detail
  // (SDK error name, HTTP status) lives on `cause` — read both levels so the
  // log names the real fault rather than the wrapper.
  const cause = e?.cause as
    | {
        name?: string;
        message?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number };
        $response?: { statusCode?: number };
      }
    | undefined;

  console.error('[Media Storage Error]', {
    key,
    stage,
    driver: driverName(),
    name: e?.name ?? null,
    message: e?.message ?? null,
    code: e?.code ?? cause?.code ?? null,
    causeName: cause?.name ?? null,
    causeMessage: cause?.message ?? null,
    httpStatus:
      e?.$metadata?.httpStatusCode ??
      e?.$response?.statusCode ??
      cause?.$metadata?.httpStatusCode ??
      cause?.$response?.statusCode ??
      null,
  });
}

/** Storage unreachable/misconfigured (e.g. S3_BUCKET unset) — never a 404. */
function storageUnavailable(key: string, err: unknown, stage = 'unknown'): Response {
  logStorageError(key, stage, err);
  return new Response('Storage unavailable', {
    status: 503,
    headers: { 'Content-Type': 'text/plain', 'Retry-After': '30' },
  });
}

// GET /media/[...key] — PUBLIC, immutable media delivery.
// Remote drivers redirect to a short-lived presigned object-store URL so large
// objects never pass through a function response; local dev proxies from disk.
export async function GET(
  _request: NextRequest,
  { params }: { params: { key: string[] } }
): Promise<Response> {
  // Build the object key defensively, outside try so the catch can log it too.
  // Catch-all segments never carry a leading '/', but an empty segment
  // (`/media//a/b`) would make join('/') emit a leading slash — and that key
  // becomes a literal "Key" in the S3 command, producing a double-slash path
  // that fails signature verification. Normalise so MEDIA_KEY_RE only ever
  // sees a bare key.
  const key = params.key
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/^\/+/, '');

  try {
    if (!MEDIA_KEY_RE.test(key) || key.includes('..')) {
      return notFound(key, 'malformed-key');
    }

    await connectDB();
    const media = await Media.findOne({ key, status: 'ready' }).select('mime');
    if (!media) {
      // Distinguish "never reserved" from "reserved but never confirmed" —
      // only a 'pending' row tells us the client died between presign and
      // confirm, and those linger until the 24h TTL purge.
      const pending = await Media.exists({ key, status: 'pending' });
      return notFound(key, pending ? 'upload-not-confirmed-pending' : 'no-media-row');
    }

    const storage = getStorage();

    if (storage.presignGetUrl) {
      let signed: string | null;
      try {
        // Presigning succeeds for absent keys, so this can hand back a URL that
        // R2 then 404s — surfacing as a broken <img> with nothing logged here.
        // HEAD first: a cheap metadata call that turns a silent downstream 404
        // into an explicit, logged one.
        const head = await storage.headObject(key);
        if (!head) return notFound(key, 'object-missing-in-storage');
        signed = await storage.presignGetUrl(key, 604800);
      } catch (err) {
        return storageUnavailable(key, err, 'headObject');
      }
      if (!signed) return notFound(key, 'presign-returned-empty');
      // Keys embed a uuid and objects are immutable, so the redirect target is
      // stable for the full 7-day signature lifetime. Caching it collapses the
      // repeat Mongo+HEAD round trips for every subsequent view.
      return new Response(null, {
        status: 302,
        headers: {
          Location: signed,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    let buffer: Buffer;
    try {
      buffer = await storage.getObject(key);
    } catch (err) {
      if ((err as Error)?.message === 'NOT_FOUND') {
        // Genuinely absent object — expected, not a fault. Logged for parity
        // with the s3 branch so a missing asset is still greppable.
        logStorageError(key, 'getObject', err);
        return notFound(key, 'object-missing-in-storage');
      }
      if ((err as Error)?.message === 'INVALID_KEY') {
        return notFound(key, 'invalid-key');
      }
      return storageUnavailable(key, err, 'getObject');
    }

    const body = new Uint8Array(buffer);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': media.mime,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(body.byteLength),
      },
    });
  } catch (error) {
    console.error(
      `Media GET error key=${key} driver=${driverName()}:`,
      error
    );
    return new Response('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
