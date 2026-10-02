import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Appointment from '@/models/Appointment';
import { appointmentStatusSchema } from '@/lib/validation/appointment';
import { objectIdSchema } from '@/lib/validation/common';
import { utcMidnight } from '@/lib/services/slots';
import { fail, ok, parsePagination } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PopulatedCard {
  urlAlias?: string;
  name?: string;
}

interface AppointmentRow {
  _id: unknown;
  cardId: PopulatedCard | null;
  userId: unknown;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  date: Date;
  slot: string;
  service: string;
  note: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

function toCardRef(populated: unknown): { urlAlias: string; name: string } {
  const c = populated as PopulatedCard | null | undefined;
  return { urlAlias: c?.urlAlias ?? '', name: c?.name ?? '' };
}

function parseBoundary(raw: string, endOfDay = false): Date | null {
  const dayOnly = utcMidnight(raw);
  if (dayOnly) {
    return endOfDay ? new Date(dayOnly.getTime() + 86_399_999) : dayOnly;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// GET /api/appointments
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'appointments');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Appointments');

    await connectDB();
    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const filter: Record<string, unknown> = { userId: user._id };

    const statusRaw = sp.get('status');
    if (statusRaw) {
      const s = appointmentStatusSchema.safeParse(statusRaw);
      if (!s.success) return fail(400, 'VALIDATION_ERROR', 'Invalid status filter');
      filter.status = s.data;
    }

    const cardIdRaw = sp.get('cardId');
    if (cardIdRaw) {
      const v = objectIdSchema.safeParse(cardIdRaw);
      if (!v.success) return fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter');
      filter.cardId = v.data;
    }

    const dateRange: Record<string, Date> = {};
    const fromRaw = sp.get('from');
    if (fromRaw) {
      const from = parseBoundary(fromRaw);
      if (!from) return fail(400, 'VALIDATION_ERROR', 'Invalid from date');
      dateRange.$gte = from;
    }
    const toRaw = sp.get('to');
    if (toRaw) {
      const to = parseBoundary(toRaw, true);
      if (!to) return fail(400, 'VALIDATION_ERROR', 'Invalid to date');
      dateRange.$lte = to;
    }
    if (Object.keys(dateRange).length > 0) filter.date = dateRange;

    const [docs, total] = await Promise.all([
      Appointment.find(filter)
        .populate('cardId', 'urlAlias name')
        .sort({ date: 1, slot: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Appointment.countDocuments(filter),
    ]);

    const items = (docs as unknown as AppointmentRow[]).map((row) => {
      const { cardId, ...rest } = row;
      return { ...rest, card: toCardRef(cardId) };
    });

    return ok({
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Appointments GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
