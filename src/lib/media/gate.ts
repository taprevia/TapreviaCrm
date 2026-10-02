/**
 * Shared upload type-gate: size caps, mime/extension whitelists and key
 * helpers. Used by the legacy buffered upload route and the serverless
 * presign/confirm flow so the two paths enforce identical rules.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // images ≤ 8MB
export const MAX_OTHER_BYTES = 10 * 1024 * 1024; // verbatim 'other' files ≤ 10MB
export const AVATAR_SIZE = 512;
export const MAX_IMAGE_WIDTH = 1600;

/** Mimes sharp (server) or the canvas pipeline (client) must confirm. */
export const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Extensions treated as image candidates (sniffed on the server path). */
export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp']);
/** Formats the image pipeline produces (always webp once processed). */
export const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

/**
 * Non-image types allowed under category='other'. The file extension AND
 * declared mime must match the whitelist entry exactly.
 */
export const OTHER_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp4: 'video/mp4',
};

/** Lowercased extension of a filename ('' when none). */
export function fileExt(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 && dot < lower.length - 1 ? lower.slice(dot + 1) : '';
}

export function utcYearMonth(date = new Date()): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mm}`;
}

export type UploadClass = {
  kind: 'image' | 'verbatim';
  /** Extension the stored key will carry. */
  storedExt: string;
  /** Server-side mime attribution (never trusts the client). */
  mime: string;
  cap: number;
};

/**
 * Classify an upload from declared attributes (category + filename + mime).
 * Throws an Error for anything outside the whitelist — callers map that to a
 * 400 VALIDATION_ERROR. The legacy buffered route additionally byte-sniffs
 * images via sharp before persisting.
 */
export function classifyUpload(
  category: string,
  name: string,
  mime: string
): UploadClass {
  const ext = fileExt(name);
  const declaredImage = IMAGE_MIMES.has(mime) || IMAGE_EXTS.has(ext);

  if (category === 'other' && !declaredImage && OTHER_TYPES[ext] === mime) {
    return {
      kind: 'verbatim',
      storedExt: ext,
      mime: OTHER_TYPES[ext],
      cap: MAX_OTHER_BYTES,
    };
  }
  if (!declaredImage) throw new Error('unsupported');
  return { kind: 'image', storedExt: 'webp', mime: 'image/webp', cap: MAX_IMAGE_BYTES };
}