import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import AnalyticsLog from '@/models/AnalyticsLog';
import { isSafeExternalUrl } from '@/lib/safe-url';

/**
 * GET /r/[slug] — Unified dynamic route resolver.
 *
 * The permanent Taprevia URL for all physical QR/NFC products.
 * Resolves the current destination from the database and redirects.
 *
 * Resolution:
 *  1. Card by routeSlug → redirect based on card kind
 *  2. Standee by routeSlug → panel redirect or zone slot redirect
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

    // ── 1. Card by routeSlug ──────────────────────────────────────────────
    const card = (await Card.findOne({ routeSlug: routeKey, isActive: true })
      .select('urlAlias slug kind redirectUrl reviewAssistant instagramConfig whatsappConfig linkedinConfig facebookConfig userId')
      .lean()) as {
      _id: unknown;
      urlAlias: string;
      slug: string;
      kind: string;
      redirectUrl: string;
      userId: unknown;
    } | null;

    if (card) {
      // Log analytics and increment tap count.
      await Promise.all([
        logRouteEvent(card._id, routeKey, slotParam, request),
        incrementTapCount(card._id),
      ]);

      // Social card → redirect to configured destination.
      if (card.kind === 'social') {
        const dest = card.redirectUrl?.trim();
        if (isSafeExternalUrl(dest)) {
          return NextResponse.redirect(dest, 302);
        }
        // Fallback to profile page if destination invalid.
        if (card.urlAlias) {
          return NextResponse.redirect(
            new URL(`/profile/${card.urlAlias}`, request.url),
            302
          );
        }
        return new Response('Destination not configured', { status: 404 });
      }

      // Review card → redirect to review page.
      if (card.kind === 'review') {
        if (card.urlAlias) {
          return NextResponse.redirect(
            new URL(`/review/${card.urlAlias}`, request.url),
            302
          );
        }
        return new Response('Review page not configured', { status: 404 });
      }

      // Profile card (default) → redirect to public profile.
      if (card.urlAlias) {
        return NextResponse.redirect(
          new URL(`/profile/${card.urlAlias}?src=qr`, request.url),
          302
        );
      }

      return new Response('Profile not configured', { status: 404 });
    }

    // ── 2. Standee by routeSlug ──────────────────────────────────────────
    // Standee routeSlugs are NOT lowercased on save (unlike Cards), so match
    // case-insensitively against the URL key (which is lowercased above).
    const standee = (await Standee.findOne({
      $expr: { $eq: [{ $toLower: '$routeSlug' }, routeKey] },
    })
      .select('userId panelQr socialQrs maxProfiles fixedProfiles')
      .lean()) as {
      userId: unknown;
      panelQr: { qrId: string; qrColor: string };
      socialQrs: Array<{ qrId: string; platform: string; qrColor: string; label: string; destinationUrl: string }>;
      maxProfiles: number;
      fixedProfiles: string[];
    } | null;

    if (standee) {
      // Multi-profile standee with slot parameter.
      if (slotParam) {
        const maxProfiles = standee.maxProfiles || standee.socialQrs?.length || 0;
        const slotIndex = parseInt(slotParam, 10) - 1; // 1-indexed to 0-indexed
        if (Number.isFinite(slotIndex) && slotIndex >= 0 && slotIndex < maxProfiles) {
          const socialQr = standee.socialQrs?.[slotIndex];
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
            return NextResponse.redirect(url, 302);
          }

          // Fallback to profile page if link not configured.
          const alias = (profile as { urlAlias?: string } | null)?.urlAlias;
          if (alias) {
            return NextResponse.redirect(
              new URL(`/profile/${alias}`, request.url),
              302
            );
          }
          return new Response('Destination not configured', { status: 404 });
        }
        return new Response('Invalid slot', { status: 404 });
      }

      // No slot → resolve the panel destination:
      //   1. Owner's profile page (if any)
      //   2. Multi-profile standeee (all-in-one 3/4) → platform picker page
      //   3. Sole configured slot destination (single-purpose standees)
      //   4. 404
      try {
        await AnalyticsLog.create({
          action: 'tap',
          metadata: `route:${routeKey}`,
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent') ?? '',
        });
      } catch {
        // Fail-open.
      }

      const alias = await Profile.findOne({ userId: standee.userId })
        .select('urlAlias socialLinks')
        .lean() as { urlAlias?: string; socialLinks?: Array<{ platform: string; url: string }> } | null;

      if (alias?.urlAlias) {
        return NextResponse.redirect(
          new URL(`/profile/${alias.urlAlias}`, request.url),
          302
        );
      }

      const profileCount = Math.max(
        standee.maxProfiles ?? 0,
        standee.fixedProfiles?.length ?? 0,
        standee.socialQrs?.length ?? 0
      );

      // Multi-profile standees render a platform picker instead of a single
      // redirect: the panel QR faces every visitor, who chooses a destination.
      if (profileCount >= 2) {
        return NextResponse.redirect(
          new URL(`/panel/${routeKey}`, request.url),
          302
        );
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
          return NextResponse.redirect(url, 302);
        }
      }

      return new Response('Panel not configured', { status: 404 });
    }

    // ── 3. Legacy fallback: cardUid, slug, or urlAlias ──────────────────
    const legacyCard = (await Card.findOne({
      isActive: true,
      $or: [
        { cardUid: routeKey.toUpperCase() },
        { slug: routeKey },
        { urlAlias: routeKey },
      ],
    })
      .select('_id urlAlias slug kind redirectUrl cardUid')
      .lean()) as {
      _id: unknown;
      urlAlias: string;
      slug: string;
      kind: string;
      redirectUrl: string;
      cardUid: string;
    } | null;

    if (legacyCard) {
      // Legacy-resolved taps count the same as routeSlug taps.
      await Promise.all([
        logRouteEvent(legacyCard._id, routeKey, null, request),
        incrementTapCount(legacyCard._id),
      ]);
      if (legacyCard.urlAlias) {
        return NextResponse.redirect(
          new URL(`/profile/${legacyCard.urlAlias}?src=qr`, request.url),
          302
        );
      }
    }

    // ── 4. 404 ─────────────────────────────────────────────────────────
    return new Response('Not found', { status: 404 });
  } catch (error) {
    console.error('Dynamic route resolver error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
