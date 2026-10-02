import { z } from 'zod';
import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Product from '@/models/Product';
import ProductEnquiry from '@/models/ProductEnquiry';
import AnalyticsLog from '@/models/AnalyticsLog';
import { objectIdSchema } from '@/lib/validation/common';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { buildWhatsAppEnquiryUrl } from '@/lib/services/whatsapp';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

const publicProductEnquirySchema = z.object({
  productId: objectIdSchema,
  name: z.string().trim().max(100).default(''),
  note: z.string().trim().max(500).default(''),
});



// POST /api/public/cards/[alias]/product-enquiries
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limit = await check(`penq:${ip}`, 15, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = publicProductEnquirySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { productId, name, note } = parsed.data;

    await connectDB();

    const card = await getPublicCardByAlias(params.alias);
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const product = await Product.findOne({
      _id: productId,
      cardId: card._id,
      active: true,
    });
    if (!product) return fail(404, 'NOT_FOUND', 'Product unavailable');

    const enquiry = await ProductEnquiry.create({
      cardId: card._id,
      userId: card.userId,
      productId,
      productTitle: product.title,
      quantity: 1,
      name,
      note,
      status: 'new',
    });

    await Product.updateOne({ _id: product._id }, { $inc: { enquiryCount: 1 } });

    await AnalyticsLog.create({
      cardId: card._id,
      action: 'product_enquiry',
      metadata: `product_enquiry:${enquiry._id}`,
      ip,
      userAgent: request.headers.get('user-agent') || '',
    });

    const whatsappUrl = buildWhatsAppEnquiryUrl(card.basic?.phone, {
      productName: product.title,
      priceMinor: product.priceMinor,
      currency: product.currency,
      alias: params.alias,
      cardName: card.name,
    });

    return ok({ whatsappUrl }, 201);
  } catch (error) {
    console.error('Public product enquiry POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
