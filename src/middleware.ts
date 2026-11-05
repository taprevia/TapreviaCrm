import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenEdge } from '@/lib/auth-edge';

const publicRoutes = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/api/auth', '/privacy', '/terms', '/cookies', '/contacts'];
const publicCardRoutes = [
  '/c/',
  '/profile/',
  '/review/',
  '/standee-review/',
  '/t/',
  '/qr/',
  '/r/', // permanent dynamic route — must never be blocked by auth
  '/panel/', // public standee platform picker
  '/media/',
  '/api/public/',
];

// Business slugs are allocated from a reserved namespace. These roots can
// never be a genuine branded public Standee path.
const NON_BRANDED_ROOTS = new Set([
  'admin',
  'api',
  'c',
  'dashboard',
  'login',
  'media',
  'panel',
  'profile',
  'qr',
  'r',
  'register',
  'review',
  'standee-review',
  'preview',
  'contacts',
  'privacy',
  'terms',
  'cookies',
  'fonts',
  't',
]);

// Standee publicSlug is always "{business}/standee" or
// "{business}/standee-N". Card publicSlugs never use the reserved
// "standee" product segment (human-url.ts reserves it for Standees).
const STANDEE_PUBLIC_PATH =
  /^\/([a-z0-9-]{1,50})\/standee(?:-[1-9][0-9]*)?\/?$/i;

function isBrandedStandeePublicPath(pathname: string): boolean {
  const match = STANDEE_PUBLIC_PATH.exec(pathname);
  if (!match) return false;
  return !NON_BRANDED_ROOTS.has(match[1].toLowerCase());
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Trusted request-method propagation for Server Components.
 *
 * Next.js does not expose the HTTP method through `headers()` in a page.
 * Middleware is the authoritative boundary: it overwrites any inbound value
 * with the real method before the request reaches application code. Public
 * visit recording accepts only GET, so HEAD never creates a visit.
 */
const REQUEST_METHOD_HEADER = 'x-tp-request-method';

function withTrustedRequestMethod(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_METHOD_HEADER, request.method.toUpperCase());
  return requestHeaders;
}

// Dev-only cache hardening: never let a browser/proxy cache an HTML page shell,
// otherwise stale UI survives code fixes. API caching behavior is untouched.
function nextWithDevNoStore(pathname: string, request: NextRequest): NextResponse {
  const response = NextResponse.next({
    request: { headers: withTrustedRequestMethod(request) },
  });
  if (process.env.NODE_ENV === 'development' && !pathname.startsWith('/api')) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
}

/**
 * CSRF rejection for cookie-session mutations. Browsers always attach an
 * Origin header to cross-origin fetch/form POSTs; same-origin requests carry a
 * matching Origin (or Sec-Fetch-Site: same-origin). Safe-methods and requests
 * without a session cookie are allowed through.
 */
function csrfAllowed(request: NextRequest): boolean {
  const method = request.method.toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return true;
  if (!request.cookies.get('token')) return true;

  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Request ID for traceability across logs and downstream systems.
  const requestId =
    request.headers.get('x-request-id') ||
    (crypto.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      requestId,
      method: request.method,
      path: pathname,
    })
  );

  try {
    return await handle(request, pathname, requestId);
  } catch (error) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        requestId,
        method: request.method,
        path: pathname,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    const res = NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }
}

async function handle(request: NextRequest, pathname: string, requestId: string) {
  // CSRF gate for cookie-authed mutations.
  if (!csrfAllowed(request)) {
    const res = NextResponse.json(
      { error: 'Cross-site request rejected', code: 'FORBIDDEN' },
      { status: 403 }
    );
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Allow public card routes and API routes without auth
  if (publicCardRoutes.some(route => pathname.startsWith(route))) {
    const res = nextWithDevNoStore(pathname, request);
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Allow auth-related routes
  if (pathname.startsWith('/api/auth')) {
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Allow public pages
  if (publicRoutes.includes(pathname)) {
    const res = nextWithDevNoStore(pathname, request);
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Check for token in cookies
  const token = request.cookies.get('token')?.value;

  if (!token) {
    // Redirect to login for protected routes
    if (pathname.startsWith('/admin') || pathname.startsWith('/dashboard')) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      const res = NextResponse.redirect(loginUrl);
      res.headers.set('x-request-id', requestId);
      return res;
    }
    // Allow other routes (might be public pages)
    const res = nextWithDevNoStore(pathname, request);
    res.headers.set('x-request-id', requestId);
    return res;
  }

  // Verify token
  const verified = await verifyTokenEdge(token);

  if (!verified) {
    // API clients expect a machine-readable 401, not an HTML login redirect.
    if (pathname.startsWith('/api/')) {
      const response = NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
      response.cookies.set('token', '', { maxAge: 0, path: '/' });
      response.headers.set('x-request-id', requestId);
      return response;
    }
    // Branded public Standee URLs are intentionally public. A stale, expired,
    // malformed, or unrelated token must not turn a printed QR scan into a
    // login redirect. Clear the stale cookie and let the public page resolve
    // normally. Protected namespaces never reach this branch.
    if (isBrandedStandeePublicPath(pathname)) {
      const response = nextWithDevNoStore(pathname, request);
      response.cookies.set('token', '', { maxAge: 0, path: '/' });
      response.headers.set('x-request-id', requestId);
      return response;
    }
    // Invalid token - clear cookie and redirect to login
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('token', '', { maxAge: 0, path: '/' });
    response.headers.set('x-request-id', requestId);
    return response;
  }

  // Role-based access control
  const { role } = verified;

  if (pathname.startsWith('/admin') && role !== 'admin') {
    // Non-admin trying to access admin routes
    const res = NextResponse.redirect(new URL('/dashboard', request.url));
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (pathname.startsWith('/dashboard') && role === 'admin') {
    // Admin trying to access customer dashboard - allow (admin can view both)
  }

  const res = nextWithDevNoStore(pathname, request);
  res.headers.set('x-request-id', requestId);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
