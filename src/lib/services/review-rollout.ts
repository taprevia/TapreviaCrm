/**
 * Tenant-specific central Review integration rollout.
 *
 * The existing global flag remains the master safety gate. This module adds a
 * versioned, separately activated tenant policy while preserving historical
 * behavior by default.
 *
 * Modes:
 *   legacy-global   (default) historical behavior: global flag alone decides.
 *   tenant-allowlist           global flag AND explicit tenant allowlist.
 *   disabled                   central public integration forced OFF.
 *
 * Unknown modes fail closed. The allowlist is environment-controlled, contains
 * stable tenant ObjectIds only, and is never exposed publicly.
 */

import { CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED } from '@/lib/review-feature-flags';

export type ReviewRolloutMode = 'legacy-global' | 'tenant-allowlist' | 'disabled';

export type ReviewRolloutReason =
  | 'global_off'
  | 'policy_disabled'
  | 'legacy_global'
  | 'tenant_allowlisted'
  | 'tenant_not_allowlisted'
  | 'invalid_tenant';

export const TENANT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export function parseReviewRolloutMode(raw: string | undefined): ReviewRolloutMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'legacy-global';
  if (value === 'legacy-global') return 'legacy-global';
  if (value === 'tenant-allowlist') return 'tenant-allowlist';
  if (value === 'disabled') return 'disabled';
  // Malformed policy configuration must never grant central integration.
  return 'disabled';
}

export function parseTenantAllowlist(raw: string | undefined): ReadonlySet<string> {
  const allowlist = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim().toLowerCase();
    if (TENANT_ID_PATTERN.test(value)) allowlist.add(value);
  }
  return allowlist;
}

export function normalizeTenantId(tenantId: unknown): string | null {
  if (tenantId === null || tenantId === undefined) return null;
  const value = String(tenantId).trim().toLowerCase();
  return TENANT_ID_PATTERN.test(value) ? value : null;
}

export interface RolloutDecisionInput {
  globalEnabled: boolean;
  mode: ReviewRolloutMode;
  allowlist: ReadonlySet<string>;
  tenantId: unknown;
}

export interface RolloutDecision {
  effective: boolean;
  tenantAllowed: boolean;
  reason: ReviewRolloutReason;
}

/** Pure decision function; exported for deterministic matrix tests. */
export function evaluateCentralIntegrationRollout(
  input: RolloutDecisionInput
): RolloutDecision {
  const tenantId = normalizeTenantId(input.tenantId);
  const tenantAllowed = tenantId !== null && input.allowlist.has(tenantId);

  if (!input.globalEnabled) {
    return { effective: false, tenantAllowed, reason: 'global_off' };
  }
  if (input.mode === 'disabled') {
    return { effective: false, tenantAllowed, reason: 'policy_disabled' };
  }
  if (input.mode === 'legacy-global') {
    // Historical behavior: the global flag alone decides.
    return { effective: true, tenantAllowed, reason: 'legacy_global' };
  }
  if (tenantId === null) {
    return { effective: false, tenantAllowed: false, reason: 'invalid_tenant' };
  }
  return tenantAllowed
    ? { effective: true, tenantAllowed: true, reason: 'tenant_allowlisted' }
    : { effective: false, tenantAllowed: false, reason: 'tenant_not_allowlisted' };
}

export const REVIEW_ROLLOUT_MODE = parseReviewRolloutMode(
  process.env.CENTRAL_REVIEW_TENANT_ROLLOUT_MODE
);
const TENANT_ALLOWLIST = parseTenantAllowlist(
  process.env.CENTRAL_REVIEW_TENANT_ALLOWLIST
);

/**
 * Effective public central-integration decision for a trusted server-side
 * tenant identity (Card/Standee owner or authenticated user). Never pass a
 * browser-supplied tenant value here.
 */
export function getCentralIntegrationRollout(tenantId: unknown): RolloutDecision {
  return evaluateCentralIntegrationRollout({
    globalEnabled: CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED,
    mode: REVIEW_ROLLOUT_MODE,
    allowlist: TENANT_ALLOWLIST,
    tenantId,
  });
}

export function isCentralPublicIntegrationEnabledForTenant(tenantId: unknown): boolean {
  return getCentralIntegrationRollout(tenantId).effective;
}

export type ReviewSettingsSource = 'legacy' | 'central' | 'hybrid';

function mongoUriPointsAtLocalhost(): boolean {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return false;
  try {
    const parsed = new URL(uri.replace(/^mongodb\+srv:\/\//i, 'mongodb://'));
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Development-only switch: make every eligible product resolve to Central
 * while localhost is running against a local MongoDB.
 *
 * Safety gates (all required):
 *   - explicit CENTRAL_REVIEW_LOCAL_FORCE_ALL=true
 *   - not a production runtime
 *   - not a deployed Vercel runtime
 *   - MONGODB_URI points at localhost / 127.0.0.1
 *
 * Production/preview/Atlas can never activate this override even if the env
 * flag is accidentally present.
 */
export function isLocalCentralReviewForceAllEnabled(): boolean {
  if (process.env.CENTRAL_REVIEW_LOCAL_FORCE_ALL !== 'true') return false;
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.VERCEL_ENV) return false;
  if (!mongoUriPointsAtLocalhost()) return false;
  return true;
}

/**
 * Presentation/read precedence for a review-capable product.
 *
 * Central OFF is intentionally identical to the historical behavior: the
 * stored source is not overridden here, and callers resolve legacy for public
 * reads exactly as before.
 *
 * Central ON keeps explicit central/hybrid connections active. A product that
 * has never been connected remains on its legacy settings — the existing
 * opt-in behavior is preserved. The stored value is never rewritten, so
 * turning central OFF restores the product's legacy behavior without data
 * loss.
 */
export function resolveEffectiveReviewSettingsSource(
  stored: unknown,
  centralEnabled: boolean,
  options: { forceAll?: boolean } = {}
): ReviewSettingsSource {
  const normalized: ReviewSettingsSource =
    stored === 'central' || stored === 'hybrid' ? stored : 'legacy';
  if (!centralEnabled) return 'legacy';
  if (options.forceAll === true && normalized === 'legacy') return 'central';
  return normalized;
}

let startupLogged = false;

/** One safe startup line; never logs allowlist IDs or secrets. */
export function logReviewRolloutStartup(): void {
  if (startupLogged) return;
  startupLogged = true;
  try {
    console.info(
      '[review-rollout] startup',
      JSON.stringify({
        mode: REVIEW_ROLLOUT_MODE,
        globalCentralEnabled: CENTRAL_REVIEW_PUBLIC_INTEGRATION_ENABLED,
        tenantAllowlistConfigured: TENANT_ALLOWLIST.size > 0,
      })
    );
  } catch {
    /* startup visibility must never block the server */
  }
}
