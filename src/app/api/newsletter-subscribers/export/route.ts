import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import NewsletterSubscriber from '@/models/NewsletterSubscriber';
import Card from '@/models/Card';
import { objectIdSchema } from '@/lib/validation/common';
import { fail } from '@/lib/api';

export const dynamic = 'force-dynamic';

const EXPORT_CAP = 5000;

interface PopulatedCard {
  urlAlias?: string;
  name?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/newsletter-subscribers/export
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'lead_capture');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include Subscribers');

    await connectDB();
    const sp = new URL(request.url).searchParams;

    const cards = await Card.find({ userId: user._id }).select('_id').lean<{ _id: unknown }[]>([]);
    const owned = cards.map((c) => String(c._id));
    const filter: Record<string, unknown> = {
      cardId: { $in: owned },
      unsubscribedAt: null,
    };

    const search = sp.get('search')?.trim();
    if (search) {
      filter.email = { $regex: new RegExp(escapeRegex(search), 'i') };
    }

    const cardIdRaw = sp.get('cardId');
    if (cardIdRaw) {
      const v = objectIdSchema.safeParse(cardIdRaw);
      if (!v.success) return fail(400, 'VALIDATION_ERROR', 'Invalid cardId filter');
      filter.cardId = { $in: owned, $eq: v.data };
    }

    interface SubscriberDoc {
      email: string;
      cardId: PopulatedCard | null;
      createdAt: Date;
    }

    const docs = await NewsletterSubscriber.find(filter)
      .populate('cardId', 'urlAlias name')
      .sort({ createdAt: -1 })
      .limit(EXPORT_CAP)
      .lean<unknown[]>();

    const csvData = (docs as unknown as SubscriberDoc[]).map((doc) => [
      doc.email,
      doc.cardId?.name || '',
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : '',
    ]);

    const csv = Papa.unparse({
      fields: ['Email', 'Card Name', 'Subscribed At'],
      data: csvData,
    });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="subscribers-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error('Newsletter subscribers export error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
