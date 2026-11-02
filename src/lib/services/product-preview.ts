/**
 * Authoritative product preview resolver.
 *
 * One place decides what "Preview" means for an assigned Card/Standee:
 *  - review Cards → the real `/review/{alias}` experience when entitlement and
 *    effective saved settings allow it;
 *  - profile Cards → the saved public profile URL (publicSlug → profile → /c/);
 *  - social Cards → their safe configured external destination;
 *  - Standees → the review host when the gate is on/eligible, otherwise the
 *    existing public panel/route so preview never regresses to a dead link.
 *
 * It never invents identifiers, mixes assignment/catalog ids with Card ids, or
 * picks another instance of the same product type. Callers pass the instance
 * they already resolved and ownership-checked on the server.
 */

import { isSafeExternalUrl } from '@/lib/safe-url';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import {
  resolveStandeeReviewHost,
} from '@/lib/services/review-standee-settings';
import { STANDEE_REVIEW_ASSISTANT_ENABLED } from '@/lib/review-feature-flags';

export type PreviewSetupReason =
  | 'missing-instance'
  | 'missing-alias'
  | 'missing-destination'
  | 'not-entitled'
  | 'disabled'
  | 'unsupported';

export type ProductPreview =
  | {
      ok: true;
      kind: 'review' | 'profile' | 'social' | 'standee';
      href: string;
    }
  | {
      ok: false;
      kind: 'card' | 'standee';
      reason: PreviewSetupReason;
      message: string;
    };

interface CardPreviewInput {
  kind?: string | null;
  urlAlias?: string | null;
  slug?: string | null;
  publicSlug?: string | null;
  redirectUrl?: string | null;
  reviewAssistant?: unknown;
  reviewSettingsSource?: unknown;
  reviewOverrides?: unknown;
  userId?: unknown;
  assignedUserId?: unknown;
}

const SETUP_MESSAGES: Record<PreviewSetupReason, string> = {
  'missing-instance': 'This product has not been assigned a physical Card yet.',
  'missing-alias': 'This Card needs a public alias before it can be previewed.',
  'missing-destination': 'Finish the destination setup before previewing this product.',
  'not-entitled': 'Reviews are not included in this product.',
  disabled: 'Reviews are disabled for this Card. Enable them in Review Management.',
  unsupported: 'This product type does not have a preview.',
};

export async function resolveCardPreview(
  card: CardPreviewInput | null | undefined
): Promise<ProductPreview> {
  if (!card) {
    return { ok: false, kind: 'card', reason: 'missing-instance', message: SETUP_MESSAGES['missing-instance'] };
  }

  const kind = (card.kind ?? 'profile').trim() || 'profile';
  const alias = (card.urlAlias ?? '').trim();

  if (kind === 'review') {
    // Mirror getPublicCardByAlias: legacy cards may only carry the printed
    // `slug`, which resolves to the same public review host.
    const reviewAlias = alias || (card.slug ?? '').trim();
    if (!reviewAlias) {
      return { ok: false, kind: 'card', reason: 'missing-alias', message: SETUP_MESSAGES['missing-alias'] };
    }
    const [entitlement, effective] = await Promise.all([
      getCardReviewEntitlement(card as never),
      resolveEffectiveReviewSettings(card as never),
    ]);
    if (!entitlement.entitled) {
      return { ok: false, kind: 'card', reason: 'not-entitled', message: SETUP_MESSAGES['not-entitled'] };
    }
    if (!effective.enabled) {
      return { ok: false, kind: 'card', reason: 'disabled', message: SETUP_MESSAGES.disabled };
    }
    return { ok: true, kind: 'review', href: `/review/${encodeURIComponent(reviewAlias)}` };
  }

  if (kind === 'social') {
    const redirect = (card.redirectUrl ?? '').trim();
    if (redirect && isSafeExternalUrl(redirect)) {
      return { ok: true, kind: 'social', href: redirect };
    }
    return { ok: false, kind: 'card', reason: 'missing-destination', message: SETUP_MESSAGES['missing-destination'] };
  }

  const publicSlug = (card.publicSlug ?? '').trim().replace(/^\/+/, '');
  if (publicSlug) return { ok: true, kind: 'profile', href: `/${publicSlug}` };
  if (alias) return { ok: true, kind: 'profile', href: `/profile/${encodeURIComponent(alias)}` };
  const slug = (card.slug ?? '').trim();
  if (slug) return { ok: true, kind: 'profile', href: `/c/${encodeURIComponent(slug)}` };
  return { ok: false, kind: 'card', reason: 'missing-destination', message: SETUP_MESSAGES['missing-destination'] };
}

export async function resolveStandeePreview(
  standee:
    | {
        routeSlug?: string | null;
        uid?: string | null;
        publicSlug?: string | null;
      }
    | null
    | undefined
): Promise<ProductPreview> {
  if (!standee) {
    return { ok: false, kind: 'standee', reason: 'missing-instance', message: SETUP_MESSAGES['missing-instance'] };
  }
  const route = (standee.routeSlug ?? standee.uid ?? '').trim();
  if (STANDEE_REVIEW_ASSISTANT_ENABLED && route) {
    const host = await resolveStandeeReviewHost(route);
    if (host) {
      return { ok: true, kind: 'standee', href: `/standee-review/${encodeURIComponent(route)}` };
    }
  }
  // Preserve the existing customer-facing Standee experience when the review
  // host is not active: the public panel, or the permanent route resolver.
  const publicSlug = (standee.publicSlug ?? '').trim().replace(/^\/+/, '');
  if (publicSlug) return { ok: true, kind: 'standee', href: `/${publicSlug}` };
  if (route) return { ok: true, kind: 'standee', href: `/r/${encodeURIComponent(route)}` };
  return { ok: false, kind: 'standee', reason: 'missing-destination', message: SETUP_MESSAGES['missing-destination'] };
}

export interface ProductUrlResolution {
  canonicalPublicUrl: string | null;
  permanentEntryUrl: string | null;
  previewUrl: string | null;
  productType: 'card' | 'standee';
  routeSource: 'review' | 'profile' | 'social' | 'standee' | 'legacy' | 'none';
  configurationStatus: 'ready' | 'setup' | 'inactive' | 'unassigned';
}

/**
 * Permanent physical-entry path. This is admin-only management metadata; it is
 * intentionally not added to customer-facing product APIs.
 *
 * Cards: /r/{routeSlug|uid} → /c/{slug}
 * Standees: /r/{routeSlug|uid} → /qr/{panelQr.qrId}
 * No identifier is generated or rewritten.
 */
export function permanentEntryPath(
  instanceType: 'card' | 'standee',
  instance: Record<string, unknown> | null | undefined
): string | null {
  if (!instance) return null;
  if (instanceType === 'card') {
    const route = String(instance.routeSlug ?? instance.uid ?? '').trim();
    if (route) return `/r/${encodeURIComponent(route)}`;
    const slug = String(instance.slug ?? '').trim();
    return slug ? `/c/${encodeURIComponent(slug)}` : null;
  }
  const route = String(instance.routeSlug ?? instance.uid ?? '').trim();
  if (route) return `/r/${encodeURIComponent(route)}`;
  const qrId = String(
    (instance.panelQr as { qrId?: string } | undefined)?.qrId ?? ''
  ).trim();
  return qrId ? `/qr/${encodeURIComponent(qrId)}` : null;
}

/** One resolver for canonical, permanent and preview URL metadata. */
export async function resolveProductUrls(input: {
  instanceType: 'card' | 'standee' | null;
  instance: Record<string, unknown> | null;
}): Promise<ProductUrlResolution> {
  if (!input.instance || !input.instanceType) {
    return {
      canonicalPublicUrl: null,
      permanentEntryUrl: null,
      previewUrl: null,
      productType: 'card',
      routeSource: 'none',
      configurationStatus: 'unassigned',
    };
  }
  const preview =
    input.instanceType === 'card'
      ? await resolveCardPreview(input.instance as never)
      : await resolveStandeePreview(input.instance as never);
  const permanentEntryUrl = permanentEntryPath(input.instanceType, input.instance);
  const canonicalPublicUrl = preview.ok ? preview.href : null;
  const kind = String(input.instance.kind ?? '').trim();
  const routeSource: ProductUrlResolution['routeSource'] =
    input.instanceType === 'standee'
      ? 'standee'
      : kind === 'review'
        ? 'review'
        : kind === 'social'
          ? 'social'
          : kind === 'profile'
            ? 'profile'
            : 'legacy';
  const configurationStatus: ProductUrlResolution['configurationStatus'] = preview.ok
    ? 'ready'
    : preview.reason === 'missing-instance'
      ? 'unassigned'
      : preview.reason === 'disabled'
        ? 'inactive'
        : 'setup';
  return {
    canonicalPublicUrl,
    permanentEntryUrl,
    previewUrl: canonicalPublicUrl,
    productType: input.instanceType,
    routeSource,
    configurationStatus,
  };
}
