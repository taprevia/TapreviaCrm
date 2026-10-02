import { NextRequest } from 'next/server';
import { z } from 'zod';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import ProductEnquiry from '@/models/ProductEnquiry';
import { fail, ok } from '@/lib/api';

type Params = { params: { id: string } };

const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'won', 'lost']),
});

const LEGAL: Record<string, string[]> = {
  new: ['contacted', 'won', 'lost'],
  contacted: ['won', 'lost', 'contacted'],
  won: [],
  lost: [],
};

// PATCH /api/product-enquiries/[id] — status pipeline for WhatsApp enquiries.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'catalogue');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Product Enquiries');

    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid status');
    }

    await connectDB();
    const enquiry = await ProductEnquiry.findById(params.id);
    if (!enquiry) return fail(404, 'NOT_FOUND', 'Enquiry not found');
    if (enquiry.userId.toString() !== user._id && user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'Not allowed');
    }

    const allowed = LEGAL[enquiry.status] ?? [];
    if (!allowed.includes(parsed.data.status)) {
      return fail(
        400,
        'VALIDATION_ERROR',
        `Invalid status transition: ${enquiry.status} → ${parsed.data.status}`
      );
    }

    enquiry.status = parsed.data.status;
    await enquiry.save();
    return ok({ enquiry });
  } catch (error) {
    console.error('ProductEnquiry PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
