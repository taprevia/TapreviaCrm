import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Appointment from '@/models/Appointment';
import { appointmentPatchSchema } from '@/lib/validation/appointment';
import { fail, ok } from '@/lib/api';

type Params = { params: { id: string } };

/** pending→confirmed|cancelled; confirmed→completed|cancelled; rest terminal. */
const APPOINTMENT_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  cancelled: [],
  completed: [],
};

function isValidId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

// PATCH /api/appointments/[id] — owner status update
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'appointments');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Appointments');

    await connectDB();

    // Pre-validate so a malformed id maps to 404 instead of a CastError 500.
    if (!isValidId(params.id)) return fail(404, 'NOT_FOUND', 'Appointment not found');

    const appointment = await Appointment.findById(params.id);
    if (!appointment) return fail(404, 'NOT_FOUND', 'Appointment not found');

    const isOwner = appointment.userId.toString() === user._id;
    if (!isOwner && user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'You do not have access to this appointment');
    }

    const body = await request.json().catch(() => null);
    const parsed = appointmentPatchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const { status } = parsed.data;

    const allowed = APPOINTMENT_TRANSITIONS[appointment.status] ?? [];
    if (allowed.length === 0) {
      return fail(400, 'VALIDATION_ERROR', 'Terminal status');
    }
    if (!allowed.includes(status)) {
      return fail(
        400,
        'VALIDATION_ERROR',
        `Invalid status transition: ${appointment.status} → ${status}`
      );
    }

    const updated = await Appointment.findByIdAndUpdate(
      appointment._id,
      { $set: { status } },
      { new: true }
    ).populate('cardId', 'urlAlias name');

    return ok({ appointment: updated });
  } catch (error) {
    console.error('Appointment PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
