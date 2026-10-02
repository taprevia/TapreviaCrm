import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import User from '@/models/User';
import Profile from '@/models/Profile';
import Card from '@/models/Card';
import Inquiry from '@/models/Inquiry';
import AdminAuditLog from '@/models/AdminAuditLog';
import Papa from 'papaparse';

export const dynamic = 'force-dynamic';

const EXPORT_LIMIT = 10;
const EXPORT_WINDOW_MS = 15 * 60_000;
const EXPORT_CAP = 5000; // bounded rows per export — an admin export must not
// read the whole collection (serverless memory + M0 tier budget).



export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const ip = clientIp(request);
    const limit = await check(`admin-export:${admin.user._id}`, EXPORT_LIMIT, EXPORT_WINDOW_MS);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many exports, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const { type = 'users' } = Object.fromEntries(new URL(request.url).searchParams);

    let csvData: Record<string, unknown>[] = [];

    if (type === 'users') {
      const users = await User.find({ role: 'customer' })
        .select('-passwordHash')
        .limit(EXPORT_CAP)
        .lean();
      const profiles = await Profile.find().limit(EXPORT_CAP).lean();
      const cards = await Card.find().limit(EXPORT_CAP).lean();

      const profileMap = new Map(profiles.map((p) => [p.userId.toString(), p]));
      const cardMap = new Map(cards.map((c) => [c.assignedUserId?.toString(), c]));

      csvData = users.map((u) => {
        const id = (u as { _id: { toString(): string } })._id.toString();
        const profile = profileMap.get(id);
        const card = cardMap.get(id);
        return {
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt,
          companyName: profile?.companyInfo?.companyName || '',
          jobTitle: profile?.personalInfo?.jobTitle || '',
          cardSlug: card?.slug || '',
          cardStatus: card?.status || '',
          totalTaps: card?.stats?.taps ?? 0,
        };
      });
    } else if (type === 'inquiries') {
      const inquiries = await Inquiry.find()
        .populate('cardId', 'urlAlias name')
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean();

      csvData = inquiries.map((i) => ({
        name: i.name,
        email: i.email,
        phone: i.phone,
        message: i.message,
        source: i.source,
        status: i.status,
        card: (i.cardId as unknown as { name?: string; urlAlias?: string })?.name || '',
        owner: (i.userId as unknown as { name?: string })?.name || '',
        createdAt: i.createdAt,
      }));
    }

    const csv = Papa.unparse(csvData);

    await AdminAuditLog.create({
      adminId: admin.user._id,
      action: 'export',
      resource: type,
      metadata: `${csvData.length} rows`,
      ip,
    });

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${type}-export.csv"`,
      },
    });
  } catch (error) {
    console.error('Admin export error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
