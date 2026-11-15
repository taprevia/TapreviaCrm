/**
 * Unified public visit analytics.
 *
 * Total Visits = successful human navigations that reach a Card or Standee
 * public destination. Recording happens only at final public boundaries:
 *
 *   - Card/Standee public pages that actually render
 *   - external redirects that are the final destination of the navigation
 *   - review pages / picker pages
 *
 * Intermediate internal redirects (/r → branded page, /qr → /panel, /t → /profile,
 * /c → /profile) deliberately do not record, so one navigation counts once.
 *
 * The event is additive: existing tap/slot/review events and stats.taps are
 * unchanged. No visitor identifiers, IPs or fingerprints are stored.
 */
import { connectDB } from '@/lib/db';
import AnalyticsLog from '@/models/AnalyticsLog';
import PublicVisitMarker from '@/models/PublicVisitMarker';
import { randomBytes } from 'crypto';

/** TTL for a standee visit-attribution marker (one redirect round-trip). */
const VISIT_MARKER_TTL_MS = 60_000;

export interface HeadersLike {
  get(name: string): string | null;
}

export interface PublicVisitInput {
  cardId?: unknown;
  standeeId?: unknown;
  headers: HeadersLike;
  /** Route handlers can pass the HTTP method; server pages cannot. */
  method?: string;
}

const BOT_UA =
  /(bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot|pinterest|discordbot|telegrambot|whatsapp|embedly|quora link preview|w3c_validator|googlebot|bingbot|ahrefs|semrush|yandex|baidu|applebot|petalbot|bytespider|gptbot|chatgpt-user|claude-web|perplexitybot)/i;

function header(headers: HeadersLike, name: string): string {
  return (headers.get(name) ?? '').trim();
}

/** Conservative non-human/prefetch filter. Unknown values are allowed. */
export function shouldRecordPublicVisit(headers: HeadersLike, method?: string): boolean {
  // Route handlers pass the real method directly. Server Components read the
  // middleware-overwritten trusted header; any inbound value was replaced
  // before application code ran.
  const requestMethod = (method ?? header(headers, 'x-tp-request-method')).toUpperCase();
  if (requestMethod && requestMethod !== 'GET') return false;

  const ua = header(headers, 'user-agent');
  if (ua && BOT_UA.test(ua)) return false;

  const purpose = [
    header(headers, 'purpose'),
    header(headers, 'sec-purpose'),
    header(headers, 'x-purpose'),
  ]
    .join(' ')
    .toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview') || purpose.includes('prerender')) {
    return false;
  }

  if (header(headers, 'next-router-prefetch')) return false;
  if (header(headers, 'x-moz').toLowerCase() === 'prefetch') return false;
  if (header(headers, 'x-middleware-subrequest')) return false;

  const dest = header(headers, 'sec-fetch-dest').toLowerCase();
  if (dest && dest !== 'document') return false;

  const mode = header(headers, 'sec-fetch-mode').toLowerCase();
  if (mode && mode !== 'navigate') return false;

  return true;
}

/**
 * Best-effort fail-open visit write. Security/visibility checks must happen
 * before this call; an analytics failure never blocks the public response.
 */
export async function recordPublicVisit(input: PublicVisitInput): Promise<void> {
  if (!input.cardId && !input.standeeId) return;
  if (!shouldRecordPublicVisit(input.headers, input.method)) return;

  try {
    await connectDB();
    await AnalyticsLog.create({
      cardId: input.cardId ?? null,
      ...(input.standeeId ? { standeeId: input.standeeId } : {}),
      action: 'public_visit',
      metadata: 'public',
    });
  } catch {
    // Fail open: analytics must never block a public navigation.
  }
}

/**
 * Mint a single-use standee visit-attribution marker.
 *
 * Returns an opaque random token bound to the exact (standeeId, cardId) pair,
 * or `null` when minting fails (fail-open: the caller proceeds with a normal
 * Card-attributed visit rather than blocking the redirect).
 */
export async function mintStandeeVisitMarker(
  standeeId: unknown,
  cardId: unknown
): Promise<string | null> {
  if (!standeeId || !cardId) return null;
  try {
    await connectDB();
    const token = randomBytes(16).toString('hex');
    await PublicVisitMarker.create({
      token,
      standeeId,
      cardId,
      expiresAt: new Date(Date.now() + VISIT_MARKER_TTL_MS),
    });
    return token;
  } catch {
    return null;
  }
}

/**
 * Atomically consume a standee visit-attribution marker.
 *
 * Only a non-expired marker whose `cardId` matches the rendered Card is
 * consumed (single-use). Returns the marker's `standeeId` so the caller can
 * attribute the visit to the Standee, or `null` when the token is missing,
 * expired, already consumed, foreign, or invalid — in which case the caller
 * records a normal Card-attributed visit.
 */
export async function consumeStandeeVisitMarker(
  token: string | null | undefined,
  cardId: unknown
): Promise<{ standeeId: unknown } | null> {
  if (!token || !cardId) return null;
  try {
    await connectDB();
    const marker = (await PublicVisitMarker.findOneAndDelete({
      token,
      cardId,
      expiresAt: { $gt: new Date() },
    }).exec()) as unknown as { standeeId?: unknown } | null;
    return marker && marker.standeeId ? { standeeId: marker.standeeId } : null;
  } catch {
    return null;
  }
}
