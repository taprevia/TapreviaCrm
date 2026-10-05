import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Inquiry from '@/models/Inquiry';
import AnalyticsLog from '@/models/AnalyticsLog';
import TenantSettings from '@/models/TenantSettings';
import { buildVcf, vcfFilename, vcfFilenameStar } from '@/lib/vcf';
import { check } from '@/lib/rate-limit';
import { fail } from '@/lib/api';
import { getPublicCardByAlias, isPublicProfileCard } from '@/lib/services/card-access';
import { toPublicCardDto } from '@/lib/dto/card.dto';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

/**
 * Build a header-safe Content-Disposition.
 *
 * `vcfFilename()` already constrains the value to `[a-z0-9-]`, but a stray
 * quote, CR/LF or semicolon would still let the header be split or injected,
 * so the ASCII form is asserted rather than trusted. A non-ASCII display name
 * rides along in the RFC 5987 `filename*` parameter, which is the only form
 * iOS Safari reads correctly.
 */
function contentDisposition(card: Parameters<typeof vcfFilename>[0]): string {
  const filename = vcfFilename(card);
  const safe = /^[\x20-\x7e]+$/.test(filename) && !/[";\\]/.test(filename)
    ? filename
    : 'contact.vcf';
  const star = vcfFilenameStar(card);
  return `attachment; filename="${safe}"${star ? `; filename*=${star}` : ''}`;
}


// GET /api/public/cards/[alias]/vcf
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limit = await check(`vcf:${ip}`, 20, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    // social/review cards are redirect-only products — never expose a downloadable
    // vCard (business contact data) for them.
    if (!isPublicProfileCard(card)) return fail(404, 'NOT_FOUND', 'Card not found');

    const settings = (await TenantSettings.findOne({ userId: card.userId }).lean()) as {
      general?: { askDetailsBeforeDownload?: boolean };
    } | null;
    const gateEnabled = settings?.general?.askDetailsBeforeDownload ?? false;

    if (gateEnabled) {
      const name = request.nextUrl.searchParams.get('n')?.trim() ?? '';
      const email = request.nextUrl.searchParams.get('e')?.trim() ?? '';

      if (!name || !email) {
        return fail(428, 'VALIDATION_ERROR', 'Contact details required before download', {
          gateRequired: true,
        });
      }

      await Inquiry.create({
        cardId: card._id,
        userId: card.userId,
        name: name.slice(0, 100),
        email: email.slice(0, 255),
        phone: request.nextUrl.searchParams.get('p')?.trim().slice(0, 20) ?? '',
        message: '',
        source: 'vcf_gate',
      });
      await AnalyticsLog.create({
        cardId: card._id,
        action: 'vcard_download',
        metadata: 'vcf_gate',
        ip,
        userAgent: request.headers.get('user-agent') ?? '',
      });
    } else {
      await AnalyticsLog.create({
        cardId: card._id,
        action: 'vcard_download',
        metadata: 'direct',
        ip,
        userAgent: request.headers.get('user-agent') ?? '',
      });
    }

    const base = request.nextUrl.origin;
    // Build the vCard from the public DTO rather than the raw document: this
    // endpoint is anonymous, so the serialised output must not be able to pick
    // up internal fields (userId, physical serials, basic.dateOfBirth) even
    // if buildVcf is later extended. The DTO's shape is a structural subset of
    // ICard, so it satisfies buildVcf without a cast.
    const doc = toPublicCardDto(card);
    const body = buildVcf(doc, base);

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/vcard; charset=utf-8',
        'Content-Disposition': contentDisposition(doc),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('VCF GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
