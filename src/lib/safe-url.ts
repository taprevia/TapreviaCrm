const MAX_HREF_LENGTH = 2048;
const MAX_LOGO_URL_LENGTH = 2048;

/**
 * Exact shape of a platform-managed media key:
 *   <24-hex userId>/<yyyy>-<mm>/<uuid>.<image ext>
 * The same grammar the /media route accepts. It is deliberately stricter than
 * a bare `/media/` prefix check: no query strings, fragments, dot segments,
 * protocol-relative forms, or foreign/non-image extensions can pass.
 */
const LOGO_MEDIA_KEY_RE =
  /^[0-9a-f]{24}\/\d{4}-\d{2}\/[A-Za-z0-9_-]+\.(?:webp|png|jpe?g)$/;

/** Only http(s) destinations are ever followed — never media paths or empty. */
export function isSafeExternalUrl(value: string): boolean {
  if (!value || value.length > MAX_HREF_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Only http(s) destinations are ever emitted into href attributes. */
export function safeExternalUrl(value: string | undefined): string {
  const url = (value ?? '').trim();
  if (!url || url.length > MAX_HREF_LENGTH) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? url : '';
  } catch {
    return '';
  }
}

/**
 * Extract the storage key only from a strictly-shaped platform logo URL.
 * Returns null for external URLs, malformed media paths, and empty values.
 */
export function mediaKeyFromLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url.startsWith('/media/')) return null;
  const key = url.slice('/media/'.length);
  return LOGO_MEDIA_KEY_RE.test(key) ? key : null;
}

/** Accept '', a strict platform `/media/<key>` path, or an http(s) URL. */
export function isSafeLogoUrl(value: unknown): boolean {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > MAX_LOGO_URL_LENGTH) return false;
  if (url.startsWith('/')) return mediaKeyFromLogoUrl(url) !== null;
  return isSafeExternalUrl(url);
}

/** Normalize absent/blank/unsafe logo values to '' for persistence and rendering. */
export function safeLogoUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return isSafeLogoUrl(url) ? url : '';
}
