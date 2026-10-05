import AnalyticsLog from '@/models/AnalyticsLog';
import type { IAnalyticsLog } from '@/types';
import { connectDB } from '@/lib/db';
import { clientIpFromHeaders, type HeadersLike } from '@/lib/request-ip';

export type PublicAnalyticsAction = IAnalyticsLog['action'];

export function publicClientIp(headers: HeadersLike): string {
  return clientIpFromHeaders(headers);
}

/**
 * Server-side analytics write for public flows that happen outside the
 * fire-and-forget `track` endpoint (e.g. server redirects). Follows the
 * same write pattern as the /t tap resolver and the review generator.
 *
 * `connectDB()` is awaited explicitly rather than assumed. `src/lib/db.ts`
 * sets `bufferCommands: false`, so a model operation issued before the pooled
 * connection is established fails immediately with "Client must be connected
 * before running operations" instead of queueing. That race only becomes
 * reachable under cold-start latency (i.e. on serverless), and analytics must
 * never be the thing that throws inside an otherwise-successful redirect.
 */
export async function logPublicCardAction(
  cardId: unknown,
  action: PublicAnalyticsAction,
  metadata = '',
  headers?: HeadersLike
): Promise<void> {
  await connectDB();
  await AnalyticsLog.create({
    cardId,
    action,
    metadata,
    ip: headers ? publicClientIp(headers) : 'unknown',
    userAgent: headers?.get('user-agent') ?? '',
  });
}