import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail } from '@/lib/api';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import { generateQRDataURL } from '@/utils/qr-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/my/qr?slug=...
 *
 * Generates a server-side QR PNG for a customer-owned product's Public URL
 * ("{origin}/{business-slug}/{product-slug}[-N]"). The encoded value is ALWAYS
 * the domain-qualified public URL — never the internal /r/ routing URL. Cards
 * and standees must already have a publicSlug allocated to produce a QR.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    const slug = request.nextUrl.searchParams.get('slug')?.toLowerCase() ?? '';
    if (!slug) return fail(400, 'VALIDATION_ERROR', 'slug is required');

    const origin = request.nextUrl.origin;

    const makeQr = async (publicSlug: string): Promise<Response> => {
      const url = `${origin}/${publicSlug}`;
      const dataUrl = await generateQRDataURL({ url, width: 320 });

      // Return as an image with no-store.
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      return new Response(new Uint8Array(buffer), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
        },
      });
    };

    // Verify ownership: the route must belong to one of the user's active products.
    const card = (await Card.findOne({ routeSlug: slug }).lean()) as
      | (Record<string, unknown> & { _id: string; publicSlug?: string })
      | null;
    if (card) {
      const owned = await UserProduct.exists({
        userId: user._id,
        status: 'active',
        cardId: card._id,
      });
      if (!owned) return fail(404, 'NOT_FOUND', 'Route not found or not owned by you');
      if (!card.publicSlug) {
        return fail(409, 'CONFLICT', 'Public URL not allocated for this product yet');
      }
      return makeQr(card.publicSlug);
    }

    const standee = (await Standee.findOne({ routeSlug: slug }).lean()) as
      | (Record<string, unknown> & { _id: string; publicSlug?: string })
      | null;
    if (standee) {
      const owned = await UserProduct.exists({
        userId: user._id,
        status: 'active',
        standeeId: standee._id,
      });
      if (!owned) return fail(404, 'NOT_FOUND', 'Route not found or not owned by you');
      if (!standee.publicSlug) {
        return fail(409, 'CONFLICT', 'Public URL not allocated for this product yet');
      }
      return makeQr(standee.publicSlug);
    }

    return fail(404, 'NOT_FOUND', 'Route not found or not owned by you');
  } catch (error) {
    console.error('QR generation error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}