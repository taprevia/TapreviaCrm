import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import Standee from '@/models/Standee';
import { deleteStandeeCascade } from '@/lib/services/standee-deletion';
import { deleteStandeeSchema } from '@/lib/validation/catalog';

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
        // Canonical title source (mirrors Card.cardLabel). Falls back to the
        // schema default `name` only for legacy docs that never got one.
        displayName: s.displayName ?? '',
        routeSlug: s.routeSlug ?? '',
        publicSlug: s.publicSlug ?? '',
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

    const body = await request.json().catch(() => null);
    const parsed = deleteStandeeSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    // Cascades the linked UserProduct and recomputes the owner's hasStandy flag
    // so no orphaned reference or stale standee entitlement is left behind.
    const result = await deleteStandeeCascade(parsed.data.standeeId);
    if (!result.ok) {
      return fail(result.status, 'NOT_FOUND', result.error);
    }

    return NextResponse.json({ success: true, remainingStandees: result.remainingStandees });
  } catch (error) {
    console.error('Admin standee delete error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
