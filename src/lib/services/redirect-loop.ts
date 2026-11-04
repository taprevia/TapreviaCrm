/**
 * Bounded internal redirect-graph safety.
 *
 * Permanent/public routes can point at one another because customer
 * destinations are intentionally allowed to be any http(s) URL — including a
 * Taprevia URL. A single string comparison with the current URL cannot detect
 * a multi-hop cycle, so this resolver follows Taprevia-internal destinations
 * for a bounded number of hops and reports a cycle before redirecting.
 *
 * External, off-origin destinations terminate the walk and are never blocked
 * merely for being on the internet.
 */

import Card from '@/models/Card';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import { withPublicCardVisibility } from '@/lib/services/card-access';
import { resolveCardDestination } from '@/lib/services/redirect-target';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { STANDEE_REVIEW_ASSISTANT_ENABLED } from '@/lib/review-feature-flags';
import {
  isStandeeReviewHostEligible,
  standeeHasGoogleReviewSlot,
  standeeReviewPath,
} from '@/lib/services/review-standee-settings';

const MAX_HOPS = 5;

/** Case/encoding/trailing-slash/query-insensitive route identity. */
export function canonicalInternalPath(value: string): string {
  let path = value;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the encoded form when a segment is not valid percent-encoding.
  }
  path = path.split('?')[0].split('#')[0].toLowerCase();
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path;
}

function sameAppHost(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, '');
  return strip(a) === strip(b);
}

/** Return a normalized internal path, or null for an external/off-origin URL. */
export function toInternalPath(
  destination: string | null | undefined,
  origin: string
): string | null {
  const value = (destination ?? '').trim();
  if (!value || !origin) return null;
  try {
    const url = new URL(value, origin);
    const base = new URL(origin);
    if (url.origin === base.origin || (url.protocol === base.protocol && sameAppHost(url.hostname, base.hostname))) {
      return canonicalInternalPath(url.pathname);
    }
    return null;
  } catch {
    return null;
  }
}

async function findCardByRoute(key: string) {
  return Card.findOne(
    withPublicCardVisibility({ $or: [{ routeSlug: key }, { uid: key }] })
  )
    .select('urlAlias slug routeSlug publicSlug kind redirectUrl cardUid')
    .lean<Record<string, unknown> | null>();
}

async function findStandeeByRoute(key: string) {
  return Standee.findOne({
    $or: [
      { $expr: { $eq: [{ $toLower: '$routeSlug' }, key] } },
      { uid: key },
    ],
  })
    .select('_id userId panelQr socialQrs maxProfiles fixedProfiles routeSlug uid productKey')
    .lean<Record<string, unknown> | null>();
}

async function findCardByAlias(key: string) {
  return Card.findOne(
    withPublicCardVisibility({ $or: [{ urlAlias: key }, { slug: key }] })
  )
    .select('urlAlias slug routeSlug publicSlug kind redirectUrl')
    .lean<Record<string, unknown> | null>();
}

async function profileNext(userId: unknown): Promise<string | null> {
  if (!userId) return null;
  const profile = (await Profile.findOne({ userId }).select('urlAlias').lean()) as
    | { urlAlias?: string }
    | null;
  return profile?.urlAlias ? `/profile/${encodeURIComponent(profile.urlAlias)}` : null;
}

function destination(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

async function resolveStandeeRoute(
  standee: Record<string, unknown>,
  slotParam: string | null,
  origin: string
): Promise<string | null> {
  const socialQrs = (standee.socialQrs as Array<Record<string, unknown>> | undefined) ?? [];
  const routeSlug = String(standee.routeSlug ?? standee.uid ?? '').trim();
  const reviewEligible =
    STANDEE_REVIEW_ASSISTANT_ENABLED && routeSlug
      ? await isStandeeReviewHostEligible(standee as never)
      : false;

  if (slotParam) {
    const maxProfiles = Number(standee.maxProfiles ?? socialQrs.length ?? 0);
    const slotIndex = parseInt(slotParam, 10) - 1;
    if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= maxProfiles) return null;
    const slot = socialQrs[slotIndex];
    if (!slot) return null;
    if (reviewEligible && String(slot.platform ?? '').trim().toLowerCase() === 'google_review') {
      return routeSlug ? standeeReviewPath(routeSlug) : null;
    }
    const direct = destination(slot.destinationUrl);
    if (direct && isSafeExternalUrl(direct)) return toInternalPath(direct, origin) ? direct : null;
    return profileNext(standee.userId);
  }

  const multiProfile =
    Number(standee.maxProfiles ?? 0) > 1 ||
    ((standee.fixedProfiles as string[] | undefined)?.length ?? 0) > 1;

  if (!multiProfile && reviewEligible && standeeHasGoogleReviewSlot(standee as never)) {
    return routeSlug ? standeeReviewPath(routeSlug) : null;
  }
  if (multiProfile && routeSlug) return `/panel/${encodeURIComponent(routeSlug)}`;

  const alias = await profileNext(standee.userId);
  if (alias) return alias;

  const configured = socialQrs.filter((slot) => {
    const direct = destination(slot.destinationUrl);
    return direct ? isSafeExternalUrl(direct) : false;
  });
  if (configured.length === 1) {
    const direct = destination(configured[0].destinationUrl);
    if (direct && isSafeExternalUrl(direct)) return toInternalPath(direct, origin) ? direct : null;
  }
  return null;
}

/**
 * Return the next Taprevia-internal destination for a path, or null when the
 * path is terminal/external/unknown. Intentionally only one hop.
 */
export async function resolveInternalRedirect(
  path: string,
  origin: string
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    return null;
  }
  const pathname = url.pathname;
  const segments = pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const [root, a, b] = segments;
  if (!root) return null;
  const r = root.toLowerCase();

  if (r === 'r') {
    if (!a) return null;
    const key = a.toLowerCase();
    const card = await findCardByRoute(key);
    if (card) {
      const next = resolveCardDestination(card as never);
      return next && toInternalPath(next, origin) ? next : null;
    }
    const standee = await findStandeeByRoute(key);
    if (standee) return resolveStandeeRoute(standee, b ?? null, origin);
    const legacy = await findCardByAlias(key);
    if (legacy) {
      const next = resolveCardDestination(legacy as never);
      return next && toInternalPath(next, origin) ? next : null;
    }
    return null;
  }

  if (r === 'qr') {
    if (!a) return null;
    const key = a.toLowerCase();
    const card = await findCardByRoute(key);
    if (card) {
      if (String(card.kind) === 'social' && isSafeExternalUrl(String(card.redirectUrl ?? ''))) {
        return toInternalPath(String(card.redirectUrl), origin);
      }
      const alias = String(card.urlAlias ?? '').trim();
      return alias ? `/profile/${encodeURIComponent(alias)}` : null;
    }
    const socialStandee = (await Standee.findOne({ 'socialQrs.qrId': a })
      .select('_id userId socialQrs routeSlug uid productKey')
      .lean()) as Record<string, unknown> | null;
    if (socialStandee) {
      const slots = (socialStandee.socialQrs as Array<Record<string, unknown>> | undefined) ?? [];
      const slot = slots.find((entry) => String(entry.qrId) === a);
      if (slot) {
        const routeSlug = String(socialStandee.routeSlug ?? socialStandee.uid ?? '').trim();
        if (
          STANDEE_REVIEW_ASSISTANT_ENABLED &&
          routeSlug &&
          String(slot.platform ?? '').trim().toLowerCase() === 'google_review' &&
          (await isStandeeReviewHostEligible(socialStandee as never))
        ) {
          return standeeReviewPath(routeSlug);
        }
        const direct = destination(slot.destinationUrl);
        if (direct && isSafeExternalUrl(direct)) return toInternalPath(direct, origin) ? direct : null;
      }
      return profileNext(socialStandee.userId);
    }
    const panel = (await Standee.findOne({
      $or: [{ 'panelQr.qrId': a }, { routeSlug: key }, { uid: key }],
    })
      .select('_id userId routeSlug uid socialQrs productKey maxProfiles fixedProfiles')
      .lean()) as Record<string, unknown> | null;
    if (panel) {
      const routeSlug = String(panel.routeSlug ?? panel.uid ?? '').trim();
      if (routeSlug) return `/panel/${encodeURIComponent(routeSlug)}`;
      return profileNext(panel.userId);
    }
    const legacy = (await Profile.findOne({ 'standeeQr.qrId': a })
      .select('standeeQr')
      .lean()) as { standeeQr?: { destinationUrl?: string } } | null;
    const legacyUrl = destination(legacy?.standeeQr?.destinationUrl);
    return legacyUrl && isSafeExternalUrl(legacyUrl) ? toInternalPath(legacyUrl, origin) : null;
  }

  if (r === 'c') {
    if (!a) return null;
    const card = await findCardByAlias(a.toLowerCase());
    if (!card) return null;
    return `/profile/${encodeURIComponent(String(card.urlAlias || card.slug || ''))}`;
  }

  if (r === 'profile') {
    if (!a) return null;
    const card = await findCardByAlias(a.toLowerCase());
    if (!card) return null;
    if (String(card.kind) === 'social') {
      const next = destination(card.redirectUrl);
      return next && isSafeExternalUrl(next) ? next : null;
    }
    if (String(card.kind) === 'review') {
      const alias = String(card.urlAlias ?? card.slug ?? '').trim();
      return alias ? `/review/${encodeURIComponent(alias)}` : null;
    }
    return null;
  }

  if (segments.length === 2) {
    // Human public URL /{business}/{product}: card dispatch only. Standee
    // public paths render a terminal panel page.
    const publicSlug = `${root.toLowerCase()}/${a.toLowerCase()}`;
    const card = (await Card.findOne({ publicSlug, isActive: true })
      .select('urlAlias slug kind redirectUrl')
      .lean()) as Record<string, unknown> | null;
    if (!card) return null;
    if (String(card.kind) === 'social') {
      const next = destination(card.redirectUrl);
      return next && isSafeExternalUrl(next) ? next : null;
    }
    if (String(card.kind) === 'review') {
      const alias = String(card.urlAlias ?? card.slug ?? '').trim();
      return alias ? `/review/${encodeURIComponent(alias)}` : null;
    }
    return null;
  }

  // /review, /panel, /standee-review and all other pages are terminal for the
  // redirect graph.
  return null;
}

/**
 * Bounded cycle check. Returns true only when a cycle is proven within
 * MAX_HOPS; longer legitimate chains are not rejected.
 */
export async function wouldRedirectLoop(
  currentPath: string,
  nextDestination: string,
  origin: string,
  maxHops: number = MAX_HOPS
): Promise<boolean> {
  const start = canonicalInternalPath(currentPath);
  const first = toInternalPath(nextDestination, origin);
  if (!first) return false;
  if (first === start) return true;

  const seen = new Set<string>([start]);
  let next = first;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (seen.has(next)) return true;
    seen.add(next);
    let following: string | null;
    try {
      following = await resolveInternalRedirect(next, origin);
    } catch {
      return false;
    }
    const normalized = following ? toInternalPath(following, origin) : null;
    if (!normalized) return false;
    if (seen.has(normalized)) return true;
    next = normalized;
  }
  // Bounded graph exhausted without a proven cycle — do not reject.
  return false;
}
