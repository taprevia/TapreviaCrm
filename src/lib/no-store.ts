import { NextResponse } from 'next/server';

/**
 * Dynamic redirect/404 responses must never be cached. A 307/302 is temporary
 * but browser/CDN caching still depends on headers.
 */
export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store',
};

export function withNoStore<T extends NextResponse>(response: T): T {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function noStoreRedirect(url: string | URL, status: 302 | 307 | 308 = 307): NextResponse {
  return withNoStore(NextResponse.redirect(url, status));
}

export function noStoreText(body: string, status: number): NextResponse {
  return withNoStore(new NextResponse(body, { status }));
}
