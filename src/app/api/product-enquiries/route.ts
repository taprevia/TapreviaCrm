import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import ProductEnquiry from '@/models/ProductEnquiry';
import { objectIdSchema } from '@/lib/validation/common';
import { fail, ok, parsePagination } from '@/lib/api';

export const dynamic = 'force-dynamic';

const ENQUIRY_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;

// GET /api/product-enquiries
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'catalogue');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Product Enquiries');

    await connectDB();
    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const filter: Record<string, unknown> = { userId: user._id };

    const statusRaw = sp.get('status');
    if (statusRaw) {
      if (!(ENQUIRY_STATUSES as readonly string[]).includes(statusRaw)) {
        return fail(400, 'VALIDATION_ERROR', 'Invalid status filter');
      }
      filter.status = statusRaw;
    }

    const cardIdRaw = sp.get('cardId');
    if (cardIdRaw) {
      const v = objectIdSchema.safeParse(cardIdRaw);
      if (!v.success) return fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter');
      filter.cardId = v.data;
    }

    const [docs, total] = await Promise.all([
      ProductEnquiry.find(filter)
        .populate('productId', 'title priceMinor currency imageUrl')
        .populate('cardId', 'urlAlias name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductEnquiry.countDocuments(filter),
    ]);

    return ok({
      items: docs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Product enquiries GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
