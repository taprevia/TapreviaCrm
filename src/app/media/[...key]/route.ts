import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';

/**
 * Exact shape of a stored key:
 *   <24-hex userId>/<yyyy>-<mm>/<uuid>.<ext>
 * Doubles as a path-traversal guard — nothing outside this grammar ever
 * reaches storage.
 */
const MEDIA_KEY_RE =
  /^[0-9a-f]{24}\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(webp|png|jpg|jpeg|pdf|doc|docx|mp4)$/;

function notFound(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain' },
  });
}

// GET /media/[...key] — PUBLIC, immutable media delivery.
// Remote drivers redirect to a short-lived presigned object-store URL so large
// objects never pass through a function response; local dev proxies from disk.
export async function GET(
  _request: NextRequest,
  { params }: { params: { key: string[] } }
): Promise<Response> {
  try {
    const key = params.key.join('/');

    if (!MEDIA_KEY_RE.test(key) || key.includes('..')) return notFound();

    await connectDB();
    const media = await Media.findOne({ key, status: 'ready' }).select('mime');
    if (!media) return notFound();

    const storage = getStorage();
    if (storage.presignGetUrl) {
      // Signature outlives the browser cache window so revalidation still hits
      // a valid URL for the next ~week without buffering any bytes here.
      const signed = await storage.presignGetUrl(key, 604800);
      if (!signed) return notFound();
      return Response.redirect(signed, 302);
    }

    let buffer: Buffer;
    try {
      buffer = await storage.getObject(key);
    } catch (err) {
      if ((err as Error)?.message === 'NOT_FOUND') return notFound();
      throw err;
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
    console.error('Media GET error:', error);
    return new Response('Internal server error', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
