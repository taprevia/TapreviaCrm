import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Inquiry from '@/models/Inquiry';
import {
  inquirySourceSchema,
  inquiryStatusSchema,
} from '@/lib/validation/inquiry';
import { objectIdSchema } from '@/lib/validation/common';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const EXPORT_CAP = 5000;

const SOURCE_LABELS: Record<string, string> = {
  contact_form: 'Contact form',
  exchange_modal: 'Exchange modal',
  vcf_gate: 'VCF gate',
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/inquiries/export
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'lead_capture');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Inquiries');

    await connectDB();
    const sp = new URL(request.url).searchParams;

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

    const docs = await Inquiry.find(filter)
      .populate('cardId', 'urlAlias name')
      .sort({ createdAt: -1 })
      .limit(EXPORT_CAP)
      .lean();

    interface PopulatedCard {
      urlAlias?: string;
      name?: string;
    }

    const csvData = docs.map((doc) => {
      const row = doc as unknown as {
        name: string;
        email: string;
        phone: string;
        message: string;
        source: string;
        status: string;
        cardId: PopulatedCard | null;
        createdAt: Date;
      };
      return [
        row.name,
        row.email || '',
        row.phone || '',
        row.message || '',
        SOURCE_LABELS[row.source] ?? row.source,
        row.status,
        row.cardId?.urlAlias || '',
        row.createdAt instanceof Date ? row.createdAt.toISOString() : '',
      ];
    });

    const csv = Papa.unparse({
      fields: ['Name', 'Email', 'Phone', 'Message', 'Source', 'Status', 'Card', 'Date'],
      data: csvData,
    });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="inquiries-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Inquiries export error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
