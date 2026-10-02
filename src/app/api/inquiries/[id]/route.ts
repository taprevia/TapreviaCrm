import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Inquiry from '@/models/Inquiry';
import { inquiryStatusPatchSchema } from '@/lib/validation/inquiry';
import { fail, ok } from '@/lib/api';

type Params = { params: { id: string } };

/**
 * Legal status transitions. `won` / `lost` are terminal (no exits),
 * and `new` cannot jump straight to `won` — it must pass through `contacted`.
 */
const INQUIRY_TRANSITIONS: Record<string, string[]> = {
  new: ['contacted', 'lost'],
  contacted: ['won', 'lost', 'contacted'],
  won: [],
  lost: [],
};

function isValidId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

// PATCH /api/inquiries/[id] — owner status update (+ optional note)
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'lead_capture');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Inquiries');

    await connectDB();

    // Pre-validate so a malformed id maps to 404 instead of a CastError 500.
    if (!isValidId(params.id)) return fail(404, 'NOT_FOUND', 'Inquiry not found');

    const inquiry = await Inquiry.findById(params.id);
    if (!inquiry) return fail(404, 'NOT_FOUND', 'Inquiry not found');

    const isOwner = inquiry.userId.toString() === user._id;
    if (!isOwner && user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'You do not have access to this inquiry');
    }

    const body = await request.json().catch(() => null);
    const parsed = inquiryStatusPatchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const { status, note } = parsed.data;

    const allowed = INQUIRY_TRANSITIONS[inquiry.status] ?? [];
    if (allowed.length === 0) {
      return fail(400, 'VALIDATION_ERROR', 'Terminal status');
    }
    if (!allowed.includes(status)) {
      return fail(
        400,
        'VALIDATION_ERROR',
        `Invalid status transition: ${inquiry.status} → ${status}`
      );
    }

    // Single atomic write: status set + optional note appended.
    const updated = await Inquiry.findByIdAndUpdate(
      inquiry._id,
      {
        $set: { status },
        ...(note ? { $push: { notes: { text: note, at: new Date() } } } : {}),
      },
      { new: true }
    ).populate('cardId', 'urlAlias name');

    return ok({ inquiry: updated });
  } catch (error) {
    console.error('Inquiry PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
