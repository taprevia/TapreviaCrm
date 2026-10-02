import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Inquiry from '@/models/Inquiry';
import {
  inquirySourceSchema,
  inquiryStatusSchema,
} from '@/lib/validation/inquiry';
import { objectIdSchema } from '@/lib/validation/common';
import { fail, ok, parsePagination } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface PopulatedCard {
  urlAlias?: string;
  name?: string;
}

interface InquiryRow {
  _id: unknown;
  cardId: PopulatedCard | null;
  userId: unknown;
  name: string;
  email: string;
  phone: string;
  message: string;
  attachmentUrl: string;
  source: string;
  status: string;
  notes: Array<{ text: string; at: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

function toCardRef(populated: unknown): { urlAlias: string; name: string } {
  const c = populated as PopulatedCard | null | undefined;
  return { urlAlias: c?.urlAlias ?? '', name: c?.name ?? '' };
}

function toListItem(row: InquiryRow) {
  const { cardId, ...rest } = row;
  return { ...rest, card: toCardRef(cardId) };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/inquiries
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'lead_capture');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Inquiries');

    await connectDB();
    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const filter: Record<string, unknown> = { userId: user._id };

    const search = sp.get('search')?.trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [
        { name: { $regex: rx } },
        { email: { $regex: rx } },
        { phone: { $regex: rx } },
        { message: { $regex: rx } },
      ];
    }

    const statusRaw = sp.get('status');
    if (statusRaw) {
      const s = inquiryStatusSchema.safeParse(statusRaw);
      if (!s.success) return fail(400, 'VALIDATION_ERROR', 'Invalid status filter');
      filter.status = s.data;
    }

    const sourceRaw = sp.get('source');
    if (sourceRaw) {
      const src = inquirySourceSchema.safeParse(sourceRaw);
      if (!src.success) return fail(400, 'VALIDATION_ERROR', 'Invalid source filter');
      filter.source = src.data;
    }

    const cardIdRaw = sp.get('cardId');
    if (cardIdRaw) {
      const v = objectIdSchema.safeParse(cardIdRaw);
      if (!v.success) return fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter');
      filter.cardId = v.data;
    }

    const [docs, total] = await Promise.all([
      Inquiry.find(filter)
        .populate('cardId', 'urlAlias name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Inquiry.countDocuments(filter),
    ]);

    const items = (docs as unknown as InquiryRow[]).map(toListItem);

    return ok({
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Inquiries GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
