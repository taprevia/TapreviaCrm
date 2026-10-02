import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import crypto from 'crypto';
import { connectDB } from '@/lib/db';
import NewsletterSubscriber from '@/models/NewsletterSubscriber';
import { optionalEmailField } from '@/lib/validation/common';
import { z } from 'zod';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import { getPublicCardByAlias } from '@/lib/services/card-access';

type Params = { params: { alias: string } };

const subscribeSchema = z.object({
  email: optionalEmailField.refine((v) => v !== '', { message: 'Email is required' }),
});

// POST /api/public/cards/[alias]/newsletter
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const limit = await check(`newsletter:${clientIp(request)}`, 10, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = subscribeSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Enter a valid email address');
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const existing = await NewsletterSubscriber.findOne({
      cardId: card._id,
      email: parsed.data.email,
    });

    if (existing) {
      if (existing.unsubscribedAt) {
        existing.unsubscribedAt = null;
        await existing.save();
      }
      return ok({ success: true, alreadySubscribed: true });
    }

    await NewsletterSubscriber.create({
      cardId: card._id,
      email: parsed.data.email,
      token: crypto.randomBytes(24).toString('hex'),
    });

    return ok({ success: true, alreadySubscribed: false }, 201);
  } catch (error) {
    console.error('Newsletter POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
