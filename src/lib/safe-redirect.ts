/**
 * Safe post-login navigation.
 *
 * Only same-origin, absolute-path targets are accepted. External URLs,
 * protocol-relative URLs, encoded/backslash tricks, control characters and
 * authentication pages (loop prevention) fall back to the role dashboard.
 */

const SAFE_BASE = 'https://taprevia.invalid';
const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

export function safePostLoginRedirect(
  value: string | null | undefined,
  role: string | null | undefined
): string {
  const fallback = role === 'admin' ? '/admin' : '/dashboard';
  const raw = (value ?? '').trim();
  if (!raw) return fallback;

  let decoded: string;
  try {
    // Decode once so encoded protocol-relative forms are inspected as the
    // browser would interpret them.
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//')) return fallback;
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;

  let url: URL;
  try {
    url = new URL(decoded, SAFE_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== SAFE_BASE) return fallback;

  const pathname = url.pathname;
  if (pathname.startsWith('//')) return fallback;
  if (AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return fallback;
  }
  if (pathname.startsWith('/admin') && role !== 'admin') return fallback;

  return `${pathname}${url.search}${url.hash}`;
}
