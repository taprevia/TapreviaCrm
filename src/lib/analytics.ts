import AnalyticsLog from '@/models/AnalyticsLog';
import type { IAnalyticsLog } from '@/types';
import { clientIpFromHeaders, type HeadersLike } from '@/lib/request-ip';

export type PublicAnalyticsAction = IAnalyticsLog['action'];

export function publicClientIp(headers: HeadersLike): string {
  return clientIpFromHeaders(headers);
}

/**
 * Server-side analytics write for public flows that happen outside the
 * fire-and-forget `track` endpoint (e.g. server redirects). Follows the
 * same write pattern as the /t tap resolver and the review generator.
 */
export async function logPublicCardAction(
  cardId: unknown,
  action: PublicAnalyticsAction,
  metadata = '',
  headers?: HeadersLike
): Promise<void> {
  await AnalyticsLog.create({
    cardId,
    action,
    metadata,
    ip: headers ? publicClientIp(headers) : 'unknown',
    userAgent: headers?.get('user-agent') ?? '',
  });
}