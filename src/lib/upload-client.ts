'use client';

/**
 * Serverless-safe client upload flow.
 *
 * 1. Images are pre-processed in the browser (orientation applied, EXIF
 *    dropped, resized to the same caps the server used to enforce with
 *    sharp) and re-encoded as webp.
 * 2. POST /api/uploads/presign → either a direct PUT URL to the object store
 *    (production; bypasses the serverless request-body cap) or {mode:'proxy'}
 *    (local/dev).
 * 3. 'direct': PUT the bytes to the store, then POST /api/uploads/confirm so
 *    the Media row becomes 'ready'. 'proxy': fall back to the legacy
 *    buffered multipart POST /api/uploads.
 *
 * The result shape matches what callers already consumed from the legacy
 * route, so swapping callers is mechanical.
 */

export interface UploadResult {
  url: string;
  key: string;
  bytes: number;
  width: number;
  height: number;
  mime: string;
}

export interface UploadFileOptions {
  category: 'avatar' | 'cover' | 'gallery' | 'product' | 'socialIcon' | 'virtualBackground' | 'other';
  cardId?: string;
}

const AVATAR_SIZE = 512;
const MAX_IMAGE_WIDTH = 1600;

function isOther(options: UploadFileOptions): boolean {
  return options.category === 'other';
}

/**
 * Browser-side equivalent of the old server sharp pipeline: orientation-aware
 * resize + webp encode. Failures degrade to the raw file (the server still
 * size/type-gates on both paths).
 */
async function prepareImage(
  file: File,
  category: UploadFileOptions['category']
): Promise<{ blob: Blob; mime: string; width?: number; height?: number }> {
  if (category === 'other') return { blob: file, mime: file.type };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');

    let drawWidth: number;
    let drawHeight: number;
    let sourceX = 0;
    let sourceY = 0;
    let sourceW = bitmap.width;
    let sourceH = bitmap.height;

    if (category === 'avatar') {
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const m = Math.min(bitmap.width, bitmap.height);
      sourceX = (bitmap.width - m) / 2;
      sourceY = (bitmap.height - m) / 2;
      sourceW = m;
      sourceH = m;
      drawWidth = AVATAR_SIZE;
      drawHeight = AVATAR_SIZE;
    } else {
      const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
      drawWidth = Math.max(1, Math.round(bitmap.width * scale));
      drawHeight = Math.max(1, Math.round(bitmap.height * scale));
      canvas.width = drawWidth;
      canvas.height = drawHeight;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceW,
      sourceH,
      0,
      0,
      drawWidth,
      drawHeight
    );
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', category === 'avatar' ? 0.82 : 0.8)
    );
    if (!blob) throw new Error('webp encode failed');
    return { blob, mime: 'image/webp', width: drawWidth, height: drawHeight };
  } catch {
    return { blob: file, mime: file.type };
  }
}

/** Legacy multipart fallback (local driver / proxy mode). */
async function uploadMultipart(file: File, options: UploadFileOptions): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('category', options.category);
  if (options.cardId) form.append('cardId', options.cardId);

  const res = await fetch('/api/uploads', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as (Partial<UploadResult> & { error?: string }) | null;
  if (!res.ok || !data?.url || typeof data.key !== 'string') {
    throw new Error(data?.error ?? 'Upload failed');
  }
  return {
    url: data.url,
    key: data.key,
    bytes: data.bytes ?? 0,
    width: data.width ?? 0,
    height: data.height ?? 0,
    mime: data.mime ?? file.type,
  };
}

export async function uploadFile(file: File, options: UploadFileOptions): Promise<UploadResult> {
  const { blob, mime, width, height } = await prepareImage(file, options.category);
  const uploadName =
    isOther(options) || blob === file ? file.name : `${file.name.replace(/\.[^.]+$/, '')}.webp`;
  const effective: File = blob === file ? file : new File([blob], uploadName, { type: mime });

  const presignRes = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      category: options.category,
      ...(options.cardId ? { cardId: options.cardId } : {}),
      file: { name: effective.name, size: effective.size, type: mime },
    }),
  });
  const presign = (await presignRes.json().catch(() => null)) as
    | { mode?: 'proxy' | 'direct'; uploadUrl?: string; key?: string; error?: string }
    | null;
  if (!presignRes.ok || !presign) {
    throw new Error(presign?.error ?? 'Upload failed');
  }

  if (presign.mode === 'proxy') {
    return uploadMultipart(effective, options);
  }

  if (!presign.uploadUrl || !presign.key) {
    throw new Error('Upload failed');
  }

  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime },
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error('Upload failed');
  }

  const confirmRes = await fetch('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: presign.key,
      bytes: effective.size,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    }),
  });
  const confirm = (await confirmRes.json().catch(() => null)) as
    | (UploadResult & { error?: string })
    | null;
  if (!confirmRes.ok || !confirm?.url) {
    throw new Error(confirm?.error ?? 'Upload failed');
  }
  return confirm;
}