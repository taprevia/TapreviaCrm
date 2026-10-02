import type { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import User from '@/models/User';
import Card from '@/models/Card';
import Inquiry from '@/models/Inquiry';
import Appointment from '@/models/Appointment';
import Product from '@/models/Product';
import ProductEnquiry from '@/models/ProductEnquiry';

export const dynamic = 'force-dynamic';
import NewsletterSubscriber from '@/models/NewsletterSubscriber';
import Media from '@/models/Media';

interface PopulatedCard {
  urlAlias?: string;
  name?: string;
}

interface InquiryRow {
  _id: unknown;
  name: string;
  email: string;
  message: string;
  status: string;
  createdAt: Date;
  cardId: PopulatedCard | null;
}

interface AppointmentRow {
  _id: unknown;
  visitorName: string;
  date: Date;
  slot: string;
  status: string;
  cardId: PopulatedCard | null;
}

function toCardRef(populated: unknown): { urlAlias: string; name: string } {
  const c = populated as PopulatedCard | null | undefined;
  return { urlAlias: c?.urlAlias ?? '', name: c?.name ?? '' };
}

// GET /api/admin/overview
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const now = new Date();
    const todayUtcMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const upcomingFilter = {
      date: { $gte: todayUtcMidnight },
      status: { $in: ['pending', 'confirmed'] as const },
    };

    const [
      usersTotal,
      adminsTotal,
      customersTotal,
      cardsTotal,
      activeCards,
      cardStatusGroups,
      inquiriesTotal,
      newInquiries,
      appointmentsTotal,
      upcomingAppointments,
      productsTotal,
      activeProducts,
      productEnquiriesTotal,
      newProductEnquiries,
      newsletterSubscribers,
      mediaAgg,
      recentInquiryDocs,
      upcomingAppointmentDocs,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'customer' }),
      Card.countDocuments({}),
      Card.countDocuments({ isActive: true }),
      Card.aggregate<{ _id: string | null; count: number }>([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Inquiry.countDocuments({}),
      Inquiry.countDocuments({ status: 'new' }),
      Appointment.countDocuments({}),
      Appointment.countDocuments(upcomingFilter),
      Product.countDocuments({}),
      Product.countDocuments({ active: true }),
      ProductEnquiry.countDocuments({}),
      ProductEnquiry.countDocuments({ status: 'new' }),
      NewsletterSubscriber.countDocuments({}),
      Media.aggregate<{ files: number; bytes: number }>([
        { $group: { _id: null, files: { $sum: 1 }, bytes: { $sum: '$bytes' } } },
      ]),
      Inquiry.find()
        .sort({ createdAt: -1 })
        .limit(6)
        .select('name email message status createdAt cardId')
        .populate<{ cardId: PopulatedCard | null }>('cardId', 'urlAlias name')
        .lean(),
      Appointment.find(upcomingFilter)
        .sort({ date: 1, slot: 1 })
        .limit(6)
        .select('visitorName date slot status cardId')
        .populate<{ cardId: PopulatedCard | null }>('cardId', 'urlAlias name')
        .lean(),
    ]);

    const cardsByStatus = new Map(
      cardStatusGroups.map((g) => [g._id ?? '', g.count])
    );

    return ok({
      totals: {
        users: usersTotal,
        admins: adminsTotal,
        customers: customersTotal,
        cards: cardsTotal,
        activeCards,
        cardsByStatus: {
          active: cardsByStatus.get('active') ?? 0,
          unassigned: cardsByStatus.get('unassigned') ?? 0,
          suspended: cardsByStatus.get('suspended') ?? 0,
        },
        inquiries: inquiriesTotal,
        newInquiries,
        appointments: appointmentsTotal,
        upcomingAppointments,
        products: productsTotal,
        activeProducts,
        productEnquiries: productEnquiriesTotal,
        newProductEnquiries,
        newsletterSubscribers,
        mediaFiles: mediaAgg[0]?.files ?? 0,
        mediaBytes: mediaAgg[0]?.bytes ?? 0,
      },
      recent: {
        inquiries: (recentInquiryDocs as unknown as InquiryRow[]).map((row) => ({
          _id: row._id,
          name: row.name,
          email: row.email,
          message: row.message,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          card: toCardRef(row.cardId),
        })),
        appointments: (upcomingAppointmentDocs as unknown as AppointmentRow[]).map(
          (row) => ({
            _id: row._id,
            visitorName: row.visitorName,
            date: row.date.toISOString(),
            slot: row.slot,
            status: row.status,
            card: toCardRef(row.cardId),
          })
        ),
      },
    });
  } catch (error) {
    console.error('Admin overview error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
