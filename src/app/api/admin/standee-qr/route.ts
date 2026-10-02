import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import Standee from '@/models/Standee';

interface PopulatedUser {
  _id: unknown;
  name?: string;
  email?: string;
}

/** GET /api/admin/standee-qr — all standees across customers (panel + social QRs). */
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();

    const standees = await Standee.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const list = standees.map((s) => {
      const owner = s.userId as unknown as PopulatedUser | null;
      return {
        _id: s._id,
        name: s.name,
        routeSlug: s.routeSlug ?? '',
        userId: owner?._id ?? null,
        userName: owner?.name || 'Unassigned',
        userEmail: owner?.email || '',
        panelQr: s.panelQr,
        socialQrs: s.socialQrs,
        createdAt: s.createdAt,
      };
    });

    return NextResponse.json({ standees: list });
  } catch (error) {
    console.error('Admin standee list error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** DELETE /api/admin/standee-qr — remove a standee ({ standeeId }). */
export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const { standeeId } = await request.json();
    if (!standeeId) {
      return fail(400, 'BAD_REQUEST', 'standeeId is required');
    }

    const deleted = await Standee.findByIdAndDelete(standeeId);
    if (!deleted) {
      return fail(404, 'NOT_FOUND', 'Standee not found');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin standee delete error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
