import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import Appointment from '@/models/Appointment';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { computeSlots, normalizeSlot, utcMidnight } from '@/lib/services/slots';
import { fail, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

// GET /api/public/cards/[alias]/appointments/slots?date=YYYY-MM-DD
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const date = new URL(request.url).searchParams.get('date') ?? '';
    if (!utcMidnight(date)) {
      return fail(400, 'VALIDATION_ERROR', 'date is required (YYYY-MM-DD)');
    }

    await connectDB();
    const card = await getPublicCardByAlias(params.alias);
    if (!card) return fail(404, 'NOT_FOUND', 'Card not found');

    const activeBookings = await Appointment.find({
      cardId: card._id,
      date: utcMidnight(date),
      status: { $in: ['pending', 'confirmed'] },
    })
      .select('slot')
      .lean();

    const booked = activeBookings.map((b) => normalizeSlot(b.slot));

    return ok({
      date,
      slots: computeSlots(card.businessHours, date, 30, booked),
    });
  } catch (error) {
    console.error('Public appointment slots error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
