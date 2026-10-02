import { z } from 'zod';
import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import Appointment from '@/models/Appointment';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { computeSlots, normalizeSlot, utcMidnight } from '@/lib/services/slots';
import { check } from '@/lib/rate-limit';
import { emailField } from '@/lib/validation/common';
import { fail, ok } from '@/lib/api';

type Params = { params: { alias: string } };

const createPublicAppointmentSchema = z.object({
  visitorName: z.string().trim().min(1, 'Name is required').max(100),
  visitorEmail: emailField,
  visitorPhone: z.string().trim().max(20).default(''),
  service: z.string().trim().max(120).default(''),
  note: z.string().trim().max(1000).default(''),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  slot: z.string().trim().min(1).max(20),
});



// POST /api/public/cards/[alias]/appointments
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const ip = clientIp(request);
    const limit = await check(`appt:${ip}`, 10, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = createPublicAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const dateObj = utcMidnight(parsed.data.date);
    if (!dateObj) return fail(400, 'VALIDATION_ERROR', 'Invalid date');

    const slot = normalizeSlot(parsed.data.slot);

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const activeBookings = await Appointment.find({
      cardId: card._id,
      date: dateObj,
      status: { $in: ['pending', 'confirmed'] },
    })
      .select('slot')
      .lean();

    const offered = computeSlots(
      card.businessHours,
      parsed.data.date,
      30,
      activeBookings.map((b) => normalizeSlot(b.slot))
    );
    if (!offered.includes(slot)) {
      return fail(400, 'VALIDATION_ERROR', 'Slot unavailable');
    }

    try {
      const appointment = await Appointment.create({
        cardId: card._id,
        userId: card.userId,
        visitorName: parsed.data.visitorName,
        visitorEmail: parsed.data.visitorEmail,
        visitorPhone: parsed.data.visitorPhone,
        service: parsed.data.service,
        note: parsed.data.note,
        date: dateObj,
        slot,
        status: 'pending',
      });
      return ok({ appointment }, 201);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return fail(409, 'CONFLICT', 'That slot was just taken');
      }
      throw error;
    }
  } catch (error) {
    console.error('Public appointment POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
