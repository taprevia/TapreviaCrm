import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { noStoreRedirect, noStoreText } from '@/lib/no-store';
import { wouldRedirectLoop } from '@/lib/services/redirect-loop';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import AnalyticsLog from '@/models/AnalyticsLog';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { check } from '@/lib/rate-limit';
import { withPublicCardVisibility } from '@/lib/services/card-access';
import {
  isCardOwnerPubliclyVisible,
  isStandeeOwnerPubliclyVisible,
} from '@/lib/services/public-owner-visibility';
import { resolveCardDestination } from '@/lib/services/redirect-target';
import { recordPublicVisit } from '@/lib/services/public-visits';
import { STANDEE_REVIEW_ASSISTANT_ENABLED } from '@/lib/review-feature-flags';
import { emitReviewEvent } from '@/lib/services/review-observability';
import {
  isStandeeReviewHostEligible,
  standeeHasGoogleReviewSlot,
  standeeReviewPath,
} from '@/lib/services/review-standee-settings';

/**
 * GET /r/[slug] — Unified dynamic route resolver.
 *
 * The permanent Taprevia URL for all physical QR/NFC products.
 * Resolves the current destination from the database and redirects.
 *
 * Resolution:
 *  1. Card by routeSlug/uid → redirect based on card kind
 *  2. Standee by routeSlug/uid → panel redirect or zone slot redirect
 *  3. Legacy fallback: cardUid, slug, urlAlias
 *  4. 404
 *
 * Multi-profile standees use /r/{routeSlug}/{slot} where slot is 1-indexed.
 */



async function logRouteEvent(
  cardId: unknown,
  slug: string,
  slot: string | null,
  request: NextRequest
): Promise<void> {
  try {
    const meta = slot ? `route:${slug}/slot:${slot}` : `route:${slug}`;
    await AnalyticsLog.create({
      cardId,
      action: 'tap',
      metadata: meta,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent') ?? '',
    });
  } catch {
    // Analytics must never block the redirect (fail-open).
  }
}

async function incrementTapCount(cardId: unknown): Promise<void> {
  try {
    await Card.updateOne({ _id: cardId }, { $inc: { 'stats.taps': 1 } });
  } catch {
    // Counter increment is best-effort.
  }
}

async function allowCardTapWrite(cardId: unknown, request: NextRequest): Promise<boolean> {
  const ipLimit = await check(`track:${clientIp(request)}`, 120, 60_000);
  if (!ipLimit.success) return false;
  const cardLimit = await check(`track-tap-card:${String(cardId)}`, 600, 60_000);
  return cardLimit.success;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string[] } }
) {
  try {
    await connectDB();
    // Catch-all [...slug]: slug arrives as an array of segments.
    // (Legacy [slug] only matched a single segment, so /r/{slug}/{slot}
    // never reached this handler and returned Next's default 404.)
    const parts = Array.isArray(params.slug) ? params.slug : [params.slug];
    const routeKey = (parts[0] ?? '').toLowerCase();
    const slotParam = parts[1] ?? null;

    // ── 1. Card by routeSlug / uid ────────────────────────────────────────
    // Dual-track lookup: legacy `routeSlug` and the new timestamp `uid` are
    // matched in parallel so both identifier generations resolve identically.
    const card = (await Card.findOne(
      withPublicCardVisibility({
        $or: [{ routeSlug: routeKey }, { uid: routeKey }],
      })
    )
      .select('urlAlias slug routeSlug publicSlug kind redirectUrl reviewAssistant instagramConfig whatsappConfig linkedinConfig facebookConfig userId')
      .lean()) as {
      _id: unknown;
      urlAlias: string;
      slug: string;
      publicSlug?: string;
      kind: string;
      redirectUrl: string;
      userId: unknown;
    } | null;

    if (card) {
      // Owner suspension revokes the public Card immediately. Do not fall
      // through to a Standee sharing the same identifier.
      if (!(await isCardOwnerPubliclyVisible(card))) {
        return noStoreText('Not found', 404);
      }
      // Resolve + validate the destination BEFORE recording a successful tap.
      // This prevents invalid/self-referential destinations from inflating
      // analytics and stops bounded internal redirect cycles.
      const destination = resolveCardDestination(card);
      if (!destination) {
        return noStoreText('Destination not configured', 404);
      }
      if (await wouldRedirectLoop(request.nextUrl.pathname, destination, request.nextUrl.origin)) {
        return noStoreText('Redirect loop detected', 404);
      }
      // External social Card: this is the final destination of the navigation.
      if (/^https?:\/\//i.test(destination)) {
        await recordPublicVisit({
          cardId: card._id,
          headers: request.headers,
          method: request.method,
        });
      }
      if (await allowCardTapWrite(card._id, request)) {
        await Promise.all([
          logRouteEvent(card._id, routeKey, slotParam, request),
          incrementTapCount(card._id),
        ]);
      }
      return noStoreRedirect(new URL(destination, request.url), 307);
    }

    // ── 2. Standee by routeSlug / uid ────────────────────────────────────
    // Standee routeSlugs are NOT lowercased on save (unlike Cards), so match
    // case-insensitively against the URL key (which is lowercased above). The
    // new timestamp `uid` is already lowercase and matched directly.
    const standee = (await Standee.findOne({
      $or: [
        { $expr: { $eq: [{ $toLower: '$routeSlug' }, routeKey] } },
        { uid: routeKey },
      ],
    })
      .select('_id userId panelQr socialQrs maxProfiles fixedProfiles routeSlug uid productKey')
      .lean()) as {
      _id: unknown;
      userId: unknown;
      panelQr: { qrId: string; qrColor: string };
      socialQrs: Array<{ qrId: string; platform: string; qrColor: string; label: string; destinationUrl: string }>;
      maxProfiles: number;
      fixedProfiles: string[];
      routeSlug?: string;
      uid?: string;
      productKey?: string;
    } | null;

    if (standee && !(await isStandeeOwnerPubliclyVisible(standee.userId))) {
      return noStoreText('Not found', 404);
    }

    if (standee) {
      const logPanelTap = async (metadata: string) => {
        try {
          await AnalyticsLog.create({
            action: 'tap',
            metadata,
            ip: clientIp(request),
            userAgent: request.headers.get('user-agent') ?? '',
          });
        } catch {
          // Fail-open.
        }
      };
      const reviewRoute = (standee.routeSlug ?? standee.uid ?? '').trim();
      const reviewEligible =
        STANDEE_REVIEW_ASSISTANT_ENABLED && Boolean(reviewRoute)
          ? await isStandeeReviewHostEligible({
              _id: standee._id,
              userId: standee.userId,
              routeSlug: standee.routeSlug,
              uid: standee.uid,
              productKey: standee.productKey,
              socialQrs: standee.socialQrs,
            })
          : false;

      // Multi-profile standee with slot parameter.
      if (slotParam) {
        const maxProfiles = standee.maxProfiles || standee.socialQrs?.length || 0;
        const slotIndex = parseInt(slotParam, 10) - 1; // 1-indexed to 0-indexed
        if (Number.isFinite(slotIndex) && slotIndex >= 0 && slotIndex < maxProfiles) {
          const socialQr = standee.socialQrs?.[slotIndex];
          if (
            reviewEligible &&
            (socialQr?.platform ?? '').trim().toLowerCase() === 'google_review'
          ) {
            const reviewDestination = standeeReviewPath(reviewRoute);
            if (await wouldRedirectLoop(request.nextUrl.pathname, reviewDestination, request.nextUrl.origin)) {
              return noStoreText('Redirect loop detected', 404);
            }
            try {
              await AnalyticsLog.create({
                action: 'tap',
                metadata: `route:${routeKey}/slot:${slotParam}/platform:google_review/standee-review`,
                ip: clientIp(request),
                userAgent: request.headers.get('user-agent') ?? '',
              });
            } catch {
              // Fail-open.
            }
            return noStoreRedirect(new URL(reviewDestination, request.url), 307);
          }
          const profile = await Profile.findOne({ userId: standee.userId })
            .select('socialLinks urlAlias')
            .lean();

          // Resolve destination: prefer the slot's own dynamic destination,
          // fall back to the shared Profile.socialLinks for backward compat.
          let url: string | undefined = socialQr?.destinationUrl?.trim();
          if (!url && socialQr?.platform) {
            url = (profile as { socialLinks?: Array<{ platform: string; url: string }> } | null)
              ?.socialLinks?.find((link) => link.platform === socialQr.platform)?.url;
          }

          if (url && isSafeExternalUrl(url)) {
            if (await wouldRedirectLoop(request.nextUrl.pathname, url, request.nextUrl.origin)) {
              return noStoreText('Redirect loop detected', 404);
            }
            await recordPublicVisit({
              standeeId: standee._id,
              headers: request.headers,
              method: request.method,
            });
            // Log analytics with slot + destination info.
            try {
              await AnalyticsLog.create({
                action: 'tap',
                metadata: `route:${routeKey}/slot:${slotParam}/platform:${socialQr?.platform ?? 'unknown'}`,
                ip: clientIp(request),
                userAgent: request.headers.get('user-agent') ?? '',
              });
            } catch {
              // Fail-open.
            }
            return noStoreRedirect(url, 307);
          }

          // Fallback to profile page if link not configured.
          const alias = (profile as { urlAlias?: string } | null)?.urlAlias;
          if (alias) {
            const profileDestination = `/profile/${alias}`;
            if (await wouldRedirectLoop(request.nextUrl.pathname, profileDestination, request.nextUrl.origin)) {
              return noStoreText('Redirect loop detected', 404);
            }
            return noStoreRedirect(new URL(profileDestination, request.url), 307);
          }
          return noStoreText('Destination not configured', 404);
        }
        return noStoreText('Invalid slot', 404);
      }

      // No slot → resolve the panel destination:
      //   1. Owner's profile page (if any)
      //   2. Multi-profile standeee (all-in-one 3/4) → platform picker page
      //   3. Sole configured slot destination (single-purpose standees)
      //   4. 404
      const multiProfileStandee =
        (standee.maxProfiles ?? 0) > 1 || (standee.fixedProfiles?.length ?? 0) > 1;

      // Multi-profile panel QRs must keep opening the profile picker. Only a
      // single-purpose Google Review Standee's panel QR enters the review host.
      // The Google Review slot itself is handled by the slot/QR branches above.
      if (
        !multiProfileStandee &&
        reviewEligible &&
        standeeHasGoogleReviewSlot({
          _id: standee._id,
          userId: standee.userId,
          socialQrs: standee.socialQrs,
        })
      ) {
        const reviewDestination = standeeReviewPath(reviewRoute);
        if (await wouldRedirectLoop(request.nextUrl.pathname, reviewDestination, request.nextUrl.origin)) {
          return noStoreText('Redirect loop detected', 404);
        }
        await logPanelTap(`route:${routeKey}`);
        return noStoreRedirect(new URL(reviewDestination, request.url), 307);
      }

      const alias = await Profile.findOne({ userId: standee.userId })
        .select('urlAlias socialLinks')
        .lean() as { urlAlias?: string; socialLinks?: Array<{ platform: string; url: string }> } | null;

      const profileCount = Math.max(
        standee.maxProfiles ?? 0,
        standee.fixedProfiles?.length ?? 0,
        standee.socialQrs?.length ?? 0
      );

      // Multi-profile standees render a platform picker instead of a single
      // redirect: the panel QR faces every visitor, who chooses a destination.
      // This must take precedence over a shared profile alias, otherwise a
      // standee owner who also has a profile never reaches the standee panel.
      if (profileCount >= 2) {
        const panelDestination = `/panel/${routeKey}`;
        if (await wouldRedirectLoop(request.nextUrl.pathname, panelDestination, request.nextUrl.origin)) {
          return noStoreText('Redirect loop detected', 404);
        }
        await logPanelTap(`route:${routeKey}`);
        return noStoreRedirect(new URL(panelDestination, request.url), 307);
      }

      if (alias?.urlAlias) {
        const profileDestination = `/profile/${alias.urlAlias}`;
        if (await wouldRedirectLoop(request.nextUrl.pathname, profileDestination, request.nextUrl.origin)) {
          return noStoreText('Redirect loop detected', 404);
        }
        await logPanelTap(`route:${routeKey}`);
        return noStoreRedirect(new URL(profileDestination, request.url), 307);
      }

      // A standee-only buyer has no profile page, so the panel QR resolves to
      // the standee's sole configured slot (audit: "redirect slot 1").
      const configuredSlots = (standee.socialQrs ?? []).filter((qr) => {
        const direct = qr.destinationUrl?.trim();
        if (isSafeExternalUrl(direct)) return true;
        return Boolean(
          qr.platform &&
            alias?.socialLinks?.find((link) => link.platform === qr.platform)?.url
        );
      });
      if (configuredSlots.length === 1) {
        const qr = configuredSlots[0];
        const direct = qr.destinationUrl?.trim();
        const url =
          direct ||
          alias?.socialLinks?.find((link) => link.platform === qr.platform)?.url;
        if (url && isSafeExternalUrl(url)) {
          if (await wouldRedirectLoop(request.nextUrl.pathname, url, request.nextUrl.origin)) {
            return noStoreText('Redirect loop detected', 404);
          }
          await recordPublicVisit({
            standeeId: standee._id,
            headers: request.headers,
            method: request.method,
          });
          await logPanelTap(`route:${routeKey}`);
          return noStoreRedirect(url, 307);
        }
      }

      return noStoreText('Panel not configured', 404);
    }

    // ── 3. Legacy fallback: cardUid, slug, or urlAlias ──────────────────
    const legacyCard = (await Card.findOne(
      withPublicCardVisibility({
        $or: [
          { cardUid: routeKey.toUpperCase() },
          { slug: routeKey },
          { urlAlias: routeKey },
        ],
      })
    )
      .select('_id urlAlias publicSlug slug kind redirectUrl cardUid userId assignedUserId')
      .lean()) as {
      _id: unknown;
      urlAlias: string;
      publicSlug?: string;
      slug: string;
      kind: string;
      redirectUrl: string;
      cardUid: string;
      userId?: unknown;
      assignedUserId?: unknown;
    } | null;

    if (legacyCard) {
      if (!(await isCardOwnerPubliclyVisible(legacyCard))) {
        return noStoreText('Not found', 404);
      }
      // Use the same product-aware resolver as the routeSlug branch so legacy
      // profile Cards with only a `slug` reach `/c/{slug}` instead of a 404.
      const destination = resolveCardDestination(legacyCard);
      if (destination) {
        if (await wouldRedirectLoop(request.nextUrl.pathname, destination, request.nextUrl.origin)) {
          return noStoreText('Redirect loop detected', 404);
        }
        if (/^https?:\/\//i.test(destination)) {
          await recordPublicVisit({
            cardId: legacyCard._id,
            headers: request.headers,
            method: request.method,
          });
        }
        // Legacy-resolved taps count the same as routeSlug taps.
        if (await allowCardTapWrite(legacyCard._id, request)) {
          await Promise.all([
            logRouteEvent(legacyCard._id, routeKey, null, request),
            incrementTapCount(legacyCard._id),
          ]);
        }
        return noStoreRedirect(new URL(destination, request.url), 307);
      }
    }

    // ── 4. 404 ─────────────────────────────────────────────────────────
    return noStoreText('Not found', 404);
  } catch (error) {
    emitReviewEvent({ event: 'review.routing.error', errorCategory: 'routing', reasonCategory: 'dynamic_route' });
    console.error('Dynamic route resolver error:', error);
    return noStoreText('Internal server error', 500);
  }
}
