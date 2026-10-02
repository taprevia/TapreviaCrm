const MAX_HREF_LENGTH = 2048;

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