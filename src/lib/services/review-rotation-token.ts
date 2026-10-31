import jwt from 'jsonwebtoken';
import { requireJwtSecret } from '@/lib/env';

/**
 * Short-lived, server-issued rotation reference.
 *
 * The token binds a suggestion to business/category/template/cycle without
 * exposing cycle mechanics in UI. It is only included in suggestion responses
 * when Smart Rotation is enabled (Phase 4C); copy requests may present it to
 * reject stale cycles. Signed server-side; clients cannot mint or alter it.
 */
const AUDIENCE = 'taprevia-review-rotation';
const ISSUER = 'taprevia';
const TTL = '30m';

export interface RotationTokenClaims {
  businessId: string;
  categoryKey: string;
  templateId: string;
  cycle: number;
  /** Optional host binding added in 4D.6. Legacy Card tokens omit it. */
  hostType?: 'card' | 'standee';
  hostId?: string;
}

export interface RotationTokenVerification {
  claims: RotationTokenClaims | null;
  /** True only when the signature/claims are valid but `exp` has passed. */
  expired: boolean;
}

export function issueRotationToken(claims: RotationTokenClaims): string {
  return jwt.sign({ ...claims, typ: 'review-rotation' }, requireJwtSecret(), {
    audience: AUDIENCE,
    issuer: ISSUER,
    expiresIn: TTL,
  });
}

/**
 * Verify signature/audience/issuer and claims while distinguishing expiry from
 * tampering. Expiry is checked manually so the copy endpoint can safely hand
 * back a refreshed token *for the same cycle*; an old-cycle token is still
 * rejected, so an expired reference can never consume a template in a newer
 * cycle.
 */
export function verifyRotationTokenDetailed(token: string): RotationTokenVerification {
  try {
    const payload = jwt.verify(token, requireJwtSecret(), {
      audience: AUDIENCE,
      issuer: ISSUER,
      ignoreExpiration: true,
    }) as Partial<RotationTokenClaims> & { typ?: string; exp?: number };
    if (
      payload.typ !== 'review-rotation' ||
      typeof payload.businessId !== 'string' ||
      typeof payload.categoryKey !== 'string' ||
      typeof payload.templateId !== 'string' ||
      typeof payload.cycle !== 'number'
    ) {
      return { claims: null, expired: false };
    }
    const expired = typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now();
    return {
      claims: {
        businessId: payload.businessId,
        categoryKey: payload.categoryKey,
        templateId: payload.templateId,
        cycle: payload.cycle,
        ...(payload.hostType === 'card' || payload.hostType === 'standee'
          ? { hostType: payload.hostType }
          : {}),
        ...(typeof payload.hostId === 'string' ? { hostId: payload.hostId } : {}),
      },
      expired,
    };
  } catch {
    return { claims: null, expired: false };
  }
}

export function verifyRotationToken(token: string): RotationTokenClaims | null {
  const verification = verifyRotationTokenDetailed(token);
  if (!verification.claims || verification.expired) return null;
  return verification.claims;
}

/**
 * Host-scoped token check.
 * Legacy tokens without a host claim are Card-scoped by definition, preserving
 * every already-issued Phase 4C/4D token. A Standee token can never be replayed
 * on a Card endpoint (or a different Standee).
 */
export function rotationTokenMatchesHost(
  claims: RotationTokenClaims,
  hostType: 'card' | 'standee',
  hostId: string
): boolean {
  if (!claims.hostType) return hostType === 'card';
  return claims.hostType === hostType && claims.hostId === hostId;
}
