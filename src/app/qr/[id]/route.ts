import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import AnalyticsLog from '@/models/AnalyticsLog';
import { isSafeExternalUrl } from '@/lib/safe-url';
import { clientIp } from '@/lib/request-ip';

/**
 * Dynamic QR resolver.
 *
 * Resolution order:
 *  0. Card by routeSlug (new unified route) — redirect based on card kind.
 *  1. Standee social QR → redirect to the customer's current URL for that
 *     platform (from Profile.socialLinks).
 *  2. Standee panel QR → redirect to the customer's public profile page.
 *  3. Legacy Profile.standeeQr (pre-Standee-collection prints).
 *  4. 404.
 */
async function recordPanelTap(qrId: string, request: NextRequest): Promise<void> {
  try {
    await AnalyticsLog.create({
      action: 'tap',
      metadata: `qr-panel:${qrId}`,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent') ?? '',
    });
  } catch {
    // Fail-open: analytics must never block the redirect.
  }
}

async function redirectToProfilePage(request: NextRequest, userId: unknown) {
  const path = `/c/${(await Card.findOne({ userId }).select('urlAlias').lean() as { urlAlias?: string } | null)?.urlAlias ?? ''}`;
  return NextResponse.redirect(
    new URL(path === '/c/' ? '/' : path, request.url),
    302
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await connectDB();
    const { id } = params;

    // 0. Card by routeSlug — new unified permanent route.
    const cardBySlug = (await Card.findOne({ routeSlug: id.toLowerCase(), isActive: true })
      .select('urlAlias slug kind redirectUrl')
      .lean()) as {
      urlAlias: string;
      slug: string;
      kind: string;
      redirectUrl: string;
    } | null;

    if (cardBySlug) {
      if (cardBySlug.kind === 'social' && isSafeExternalUrl(cardBySlug.redirectUrl)) {
        return NextResponse.redirect(cardBySlug.redirectUrl, 302);
      }
      if (cardBySlug.urlAlias) {
        return NextResponse.redirect(
          new URL(`/profile/${cardBySlug.urlAlias}`, request.url),
          302
        );
      }
    }

    // 1. Social platform QR — resolve destination at scan time.
    const standee = (await Standee.findOne({ 'socialQrs.qrId': id })
      .select('userId socialQrs')
      .lean()) as {
      userId: unknown;
      socialQrs: Array<{ qrId: string; platform: string; destinationUrl: string }>;
    } | null;
    if (standee) {
      const socialQr = standee.socialQrs.find((q) => q.qrId === id);
      if (socialQr) {
        // Prefer the slot's own dynamic destination; else fall back to the
        // shared Profile.socialLinks.
        let url: string | undefined = socialQr.destinationUrl?.trim();
        if (!url) {
          const profile = (await Profile.findOne({ userId: standee.userId })
            .select('socialLinks')
            .lean()) as { socialLinks?: Array<{ platform: string; url: string }> } | null;
          url = profile?.socialLinks?.find(
            (link) => link.platform === socialQr.platform
          )?.url;
        }
        if (url && isSafeExternalUrl(url)) return NextResponse.redirect(url, 302);
      }
      return redirectToProfilePage(request, standee.userId);
    }

    // 2. Panel QR — entry point to the customer's public profile.
    const panel = (await Standee.findOne({ 'panelQr.qrId': id })
      .select('userId')
      .lean()) as { userId: unknown } | null;
    if (panel) {
      await recordPanelTap(id, request);
      return redirectToProfilePage(request, panel.userId);
    }

    // 3. Legacy embedded standeeQr (QRs printed before the Standee collection).
    const legacy = (await Profile.findOne({ 'standeeQr.qrId': id })
      .select('standeeQr')
      .lean()) as { standeeQr?: { destinationUrl?: string } } | null;
    const legacyUrl = legacy?.standeeQr?.destinationUrl;
    // Unsafe/malformed stored destinations fall through to 404 — never a
    // protocol-jumping redirect (java/script/file/…).
    if (legacyUrl && isSafeExternalUrl(legacyUrl)) {
      return NextResponse.redirect(legacyUrl, 302);
    }

    return new Response('Not found', { status: 404 });
  } catch (error) {
    console.error('QR redirect error:', error);
    return new Response('Internal server error', { status: 500 });
  }
}
