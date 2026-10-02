import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Inquiry from '@/models/Inquiry';
import AnalyticsLog from '@/models/AnalyticsLog';
import { publicInquirySchema } from '@/lib/validation/inquiry';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import { getPublicCardByAlias } from '@/lib/services/card-access';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };



// POST /api/public/cards/[alias]/inquiries
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limit = await check(`inquiry:${ip}`, 30, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = publicInquirySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const inquiry = await Inquiry.create({
      cardId: card._id,
      userId: card.userId,
      ...parsed.data,
    });

    await AnalyticsLog.create({
      cardId: card._id,
      action: parsed.data.source === 'exchange_modal' ? 'exchange' : 'form_submit',
      metadata: `inquiry:${inquiry._id}`,
      ip,
      userAgent: request.headers.get('user-agent') || '',
    });

    return ok({ success: true }, 201);
  } catch (error) {
    console.error('Public inquiry POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
