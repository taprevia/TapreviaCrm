/**
 * Client-IP extraction for rate-limit bucketing and analytics.
 *
 * `X-Forwarded-For` is client-controllable when the request doesn't cross a
 * trust boundary that overwrites it, so the raw header must never be used
 * verbatim as a rate-limit key. This module prefers hop headers set by the
 * edge proxy (`X-Real-IP`, `CF-Connecting-IP`) and only falls back to
 * `X-Forwarded-For`'s RIGHT-MOST entry — the value appended by the nearest
 * trusted proxy, not the attacker-supplied left side. Unparseable values
 * collapse to `'unknown'`, which bounds spoofing to a single shared bucket
 * instead of a per-spoofed-value bypass.
 */

import type { NextRequest } from 'next/server';

/** Minimal structural view of request headers (ReadonlyHeaders/Headers). */
export interface HeadersLike {
  get(name: string): string | null;
}

function plausibleIp(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 45) return false;

  if (v.includes(':')) {
    // IPv6 — allow hex digits, colons and zone-id dots only.
    return /^[0-9a-fA-F:.]+$/.test(v);
  }

  // IPv4 — four octets, each ≤ 255 (rejects "999.999.999.999" spoofs).
  const octets = v.split('.');
  if (octets.length !== 4) return false;
  return octets.every((o) => {
    if (!/^\d{1,3}$/.test(o)) return false;
    return Number(o) <= 255;
  });
}

/**
 * Hardened extraction from a NextRequest. Prefers edge-set hop headers,
 * then the right-most appended XFF entry. Never returns an unvalidated value.
 */
export function clientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

/** Same hardening against a plain headers object (ReadonlyHeaders/Headers). */
export function clientIpFromHeaders(headers: HeadersLike): string {
  const realIp = headers.get('x-real-ip');
  if (realIp && plausibleIp(realIp)) return realIp.trim();

  const cfIp = headers.get('cf-connecting-ip');
  if (cfIp && plausibleIp(cfIp)) return cfIp.trim();

  const xff = headers.get('x-forwarded-for') ?? '';
  const entries = xff
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (plausibleIp(entries[i])) return entries[i];
  }

  return 'unknown';
}