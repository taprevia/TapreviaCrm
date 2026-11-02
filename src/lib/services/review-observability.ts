/**
 * Privacy-safe operational events for the AI Review system.
 *
 * Events are sanitized JSON lines on the existing server console. No external
 * monitoring SDK, no new persistent collection, no customer content, no raw
 * tenant IDs, and no secrets. Monitoring failures must never break generation.
 */

import crypto from 'node:crypto';

export type ReviewEventName =
  | 'review.generation.success'
  | 'review.generation.failure'
  | 'review.generation.limit_reached'
  | 'review.provider.timeout'
  | 'review.provider.unavailable'
  | 'review.library.no_match'
  | 'review.rollout.denied'
  | 'review.rollout.allowed'
  | 'review.security.tenant_boundary_denied'
  | 'review.health.failure'
  | 'review.routing.error';

export type ReviewErrorCategory =
  | 'config'
  | 'decrypt'
  | 'empty_response'
  | 'daily_limit'
  | 'alias_limit'
  | 'no_match'
  | 'provider_timeout'
  | 'provider_4xx'
  | 'provider_5xx'
  | 'provider_unavailable'
  | 'tenant_boundary'
  | 'internal'
  | 'routing'
  | 'health';

export interface ReviewOperationalEvent {
  event: ReviewEventName;
  requestId?: string;
  engine?: 'library' | 'openai';
  outcome?: 'success' | 'failure' | 'limited' | 'denied' | 'allowed' | 'no_match';
  errorCategory?: ReviewErrorCategory;
  hostType?: 'card' | 'standee';
  durationMs?: number;
  /** Trusted server-side tenant identity. Hashed before logging. */
  tenantId?: unknown;
  /** Short, non-sensitive reason category from rollout decisions. */
  reasonCategory?: string;
}

const SAFE_TOKEN = /^[a-z0-9_.:-]{0,64}$/i;

/** Stable, non-reversible per-environment tenant correlation token. */
export function tenantCorrelation(tenantId: unknown): string {
  const raw = tenantId === null || tenantId === undefined ? '' : String(tenantId).trim();
  const secret = process.env.APP_KEY || process.env.JWT_SECRET || '';
  if (!raw || !secret) return 'unavailable';
  try {
    return crypto.createHmac('sha256', secret).update(raw).digest('hex').slice(0, 12);
  } catch {
    return 'unavailable';
  }
}

function defaultLevel(event: ReviewEventName): 'info' | 'warn' | 'error' {
  if (
    event === 'review.generation.failure' ||
    event === 'review.provider.timeout' ||
    event === 'review.provider.unavailable' ||
    event === 'review.security.tenant_boundary_denied' ||
    event === 'review.health.failure' ||
    event === 'review.routing.error'
  ) {
    return 'error';
  }
  if (
    event === 'review.generation.limit_reached' ||
    event === 'review.library.no_match' ||
    event === 'review.rollout.denied'
  ) {
    return 'warn';
  }
  return 'info';
}

function safeToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return SAFE_TOKEN.test(value) ? value : undefined;
}

/**
 * Emit one sanitized operational event. Any exception is swallowed so that
 * monitoring can never affect the customer-facing response.
 */
export function emitReviewEvent(event: ReviewOperationalEvent): void {
  try {
    const level = defaultLevel(event.event);
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope: 'review',
      event: event.event,
    };
    if (event.requestId) payload.requestId = safeToken(event.requestId);
    if (event.engine) payload.engine = event.engine;
    if (event.outcome) payload.outcome = event.outcome;
    if (event.errorCategory) payload.errorCategory = event.errorCategory;
    if (event.hostType) payload.hostType = event.hostType;
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
      payload.durationMs = Math.max(0, Math.round(event.durationMs));
    }
    if (event.tenantId !== undefined) {
      payload.tenantCorrelation = tenantCorrelation(event.tenantId);
    }
    if (event.reasonCategory) payload.reasonCategory = safeToken(event.reasonCategory);
    const line = JSON.stringify(payload);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  } catch {
    /* observability must be fail-open */
  }
}

/** Categorize an OpenAI/provider failure without logging its payload. */
export function classifyProviderError(error: unknown): ReviewErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|abort|ETIMEDOUT/i.test(message)) return 'provider_timeout';
  if (/\(401\)|\(403\)|\(429\)|invalid.*key|unauthorized|forbidden/i.test(message)) {
    return 'provider_4xx';
  }
  if (/\(5\d\d\)|server error|service unavailable|bad gateway/i.test(message)) {
    return 'provider_5xx';
  }
  return 'provider_unavailable';
}
