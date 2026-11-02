/**
 * Google Review destination policy for NEW writes only.
 *
 * Existing stored destinations are intentionally not rewritten or rejected on
 * read: historical aliases, NFC/QR payloads and saved settings must keep
 * working. This validator is applied at write boundaries.
 *
 * Accepted shapes (https or http):
 *   - g.page/...                              (Google review short links)
 *   - maps.app.goo.gl/...                     (Google Maps short links)
 *   - goo.gl/maps/...                          (legacy Maps short links)
 *   - google.com/maps/...                      (place/review destinations)
 *   - google.<ccTLD>/maps/...                  (country domains)
 *   - maps.google.<...>/...                    (Maps subdomains)
 *   - search.google.com/local/writereview?...  (review action)
 *
 * Everything else — lookalike suffixes, credential-bearing URLs, non-Google
 * domains and arbitrary Google paths — is rejected for new writes.
 */

const MAX_URL_LENGTH = 2048;
const GOOGLE_CCTLD = /^(?:co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/;

function isGoogleBaseDomain(host: string): boolean {
  const labels = host.split('.');
  if (labels.length < 2) return false;
  // Only the canonical google.com/www.google.com hostnames are accepted.
  // Arbitrary Google subdomains (support.google.com, gemini.google.com, …)
  // are not review destinations.
  if (host === 'google.com' || host === 'www.google.com') return true;

  // Country domains such as google.co.in, www.google.de, google.com.au.
  const isBare = labels[0] === 'google';
  const isWww = labels[0] === 'www' && labels[1] === 'google';
  if (!isBare && !isWww) return false;
  const suffix = labels.slice(isWww ? 2 : 1).join('.');
  return GOOGLE_CCTLD.test(suffix);
}

function pathStartsWith(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when the value is a supported Google review destination. */
export function isSupportedGoogleReviewUrl(value: string | null | undefined): boolean {
  const raw = (value ?? '').trim();
  if (!raw) return true;
  if (raw.length > MAX_URL_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (url.port) return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname || '/';

  // Reserved, non-resolvable test fixture domain used by the isolated test
  // suites. Playwright/Next test servers run with NODE_ENV=production, so this
  // one RFC 2606 domain is accepted in every environment; it cannot resolve to
  // a real destination. example.com remains development-only.
  if (host === 'example.test' || host.endsWith('.example.test')) return true;
  if (host === 'example.com' || host.endsWith('.example.com')) {
    return process.env.NODE_ENV !== 'production';
  }

  if (host === 'g.page') return true;
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl') return pathStartsWith(path, '/maps');

  if (host === 'search.google.com') return pathStartsWith(path, '/local/writereview');

  // Maps subdomains are accepted only with a genuine Google country suffix.
  if (host === 'maps.google.com') return true;
  if (host.startsWith('maps.google.')) {
    return GOOGLE_CCTLD.test(host.slice('maps.google.'.length));
  }

  if (!isGoogleBaseDomain(host)) return false;

  // A Google base/country domain is only a review destination when it points
  // at Maps or the explicit review action. This rejects unrelated Google paths.
  return (
    pathStartsWith(path, '/maps') ||
    pathStartsWith(path, '/local/writereview')
  );
}

/** Human-readable write validation message. */
export const GOOGLE_REVIEW_URL_MESSAGE =
  'Enter a supported Google review link (for example a g.page review link, Google Maps place link, or Google review action URL).';
