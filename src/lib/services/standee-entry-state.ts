/**
 * Pure preflight for branded Standee entry delegation.
 *
 * The branded page may only delegate to the existing /r resolver when doing so
 * is unambiguously safe. All uncertain cases intentionally retain the current
 * picker. No database, analytics, environment or network access belongs here.
 */

import { isSafeExternalUrl } from '@/lib/safe-url';

export type StandeeProfileClass =
  | 'modern-multi'
  | 'legacy-multi'
  | 'single'
  | 'ambiguous';

export type StandeeEntryPickerReason =
  | 'no-route'
  | 'origin-unavailable'
  | 'legacy-multi'
  | 'ambiguous'
  | 'unconfigured'
  | 'unsafe-destination'
  | 'same-origin';

export type StandeeEntryDecision =
  | {
      action: 'delegate';
      routeKey: string;
      path: string;
    }
  | {
      action: 'picker';
      reason: StandeeEntryPickerReason;
    };

export interface StandeeEntryInput {
  routeSlug?: string | null;
  uid?: string | null;
  maxProfiles?: number | null;
  fixedProfiles?: string[] | null;
  socialQrs?: Array<{
    platform?: string | null;
    destinationUrl?: string | null;
  }> | null;
  socialLinks?: Array<{
    platform?: string | null;
    url?: string | null;
  }> | null;
  /** Trusted canonical origin, or null when it cannot be established. */
  origin?: string | null;
}

const ROUTE_KEY_PATTERN = /^[a-z0-9_-]{1,80}$/i;

/** Prefer the stored routeSlug, then the legacy UID. */
export function selectStandeeRouteKey(input: {
  routeSlug?: string | null;
  uid?: string | null;
}): string | null {
  const routeSlug = String(input.routeSlug ?? '').trim();
  const uid = String(input.uid ?? '').trim();
  const route = routeSlug || uid;
  if (!route || !ROUTE_KEY_PATTERN.test(route)) return null;
  return route;
}

export function buildStandeeDelegatePath(routeKey: string): string | null {
  if (!ROUTE_KEY_PATTERN.test(routeKey)) return null;
  return `/r/${encodeURIComponent(routeKey)}`;
}

export function classifyStandeeProfile(input: {
  maxProfiles?: number | null;
  fixedProfiles?: string[] | null;
  socialQrs?: unknown[] | null;
}): StandeeProfileClass {
  const maxProfiles = Number(input.maxProfiles ?? 0);
  const fixedProfiles = input.fixedProfiles?.length ?? 0;
  const socialQrs = input.socialQrs?.length ?? 0;

  // Modern AIO products declare maxProfiles/fixedProfiles. Any credible
  // multi-profile signal wins over the configured-destination count.
  if (maxProfiles > 1 || fixedProfiles > 1) return 'modern-multi';

  // Legacy AIO can have multiple socialQrs but missing max/fixed metadata.
  // The current /r review guard may misclassify this case, so it must not
  // delegate.
  if (socialQrs > 1) return 'legacy-multi';

  // Only positively-confirmed single-profile records may delegate. Missing
  // metadata is ambiguous and stays on the picker.
  if (maxProfiles === 1 && fixedProfiles <= 1 && socialQrs <= 1) return 'single';

  return 'ambiguous';
}

export function resolveStandeeCandidateDestination(input: {
  socialQrs?: Array<{
    platform?: string | null;
    destinationUrl?: string | null;
  }> | null;
  socialLinks?: Array<{
    platform?: string | null;
    url?: string | null;
  }> | null;
}): string | null {
  const slot = input.socialQrs?.[0];
  if (!slot) return null;

  const direct = String(slot.destinationUrl ?? '').trim();
  if (direct) return direct;

  const platform = String(slot.platform ?? '').trim().toLowerCase();
  if (!platform) return null;

  const shared = input.socialLinks?.find(
    (link) =>
      String(link.platform ?? '').trim().toLowerCase() === platform &&
      String(link.url ?? '').trim().length > 0
  );
  return shared ? String(shared.url).trim() : null;
}

function isSafeExternalDestination(value: string): boolean {
  if (!isSafeExternalUrl(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isSameOriginDestination(destination: string, origin: string): boolean {
  try {
    const target = new URL(destination, origin);
    const base = new URL(origin);
    return target.origin === base.origin;
  } catch {
    // Unparseable destinations are not classified as safe external links.
    return true;
  }
}

/**
 * Decide whether the branded page may delegate through /r.
 *
 * Modern multi-profile records delegate (existing /r → /panel picker).
 * Single-profile records delegate only with one safe external destination.
 * Everything else keeps the current picker, including origin-unavailable
 * environments, legacy AIO, same-origin destinations, and ambiguous metadata.
 */
export function resolveStandeeEntryDecision(
  input: StandeeEntryInput
): StandeeEntryDecision {
  const routeKey = selectStandeeRouteKey(input);
  if (!routeKey) return { action: 'picker', reason: 'no-route' };

  const origin = String(input.origin ?? '').trim();
  if (!origin) return { action: 'picker', reason: 'origin-unavailable' };

  const path = buildStandeeDelegatePath(routeKey);
  if (!path) return { action: 'picker', reason: 'no-route' };

  const profileClass = classifyStandeeProfile(input);

  if (profileClass === 'legacy-multi') {
    return { action: 'picker', reason: 'legacy-multi' };
  }
  if (profileClass === 'ambiguous') {
    return { action: 'picker', reason: 'ambiguous' };
  }
  if (profileClass === 'modern-multi') {
    return { action: 'delegate', routeKey, path };
  }

  const destination = resolveStandeeCandidateDestination(input);
  if (!destination) return { action: 'picker', reason: 'unconfigured' };
  if (!isSafeExternalDestination(destination)) {
    return { action: 'picker', reason: 'unsafe-destination' };
  }
  if (isSameOriginDestination(destination, origin)) {
    return { action: 'picker', reason: 'same-origin' };
  }

  return { action: 'delegate', routeKey, path };
}
