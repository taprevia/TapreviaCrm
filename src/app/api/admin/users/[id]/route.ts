import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import User from '@/models/User';
import Card from '@/models/Card';
import Profile from '@/models/Profile';
import Lead from '@/models/Lead';
import AnalyticsLog from '@/models/AnalyticsLog';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';
import { updateCustomerCredentialsSchema } from '@/lib/validation/catalog';

interface CardLean {
  _id: string;
  cardUid: string;
  slug: string;
  urlAlias?: string;
  templateKey?: string;
  status: string;
  stats?: { taps?: number };
  assignedUserId: string | null;
  createdAt: Date;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const { id } = params;

    const user = await User.findById(id).select('-passwordHash').lean();
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const profile = await Profile.findOne({ userId: id }).lean();
    const cards = (await Card.find({ assignedUserId: id }).sort({ createdAt: -1 }).lean()) as unknown as CardLean[];
    const card = cards[0] ?? null;
    const leads = await Lead.find({ cardOwnerId: id }).sort({ createdAt: -1 }).limit(50).lean();
    const standees = await Standee.find({ userId: id }).sort({ createdAt: -1 }).lean();

    let analytics = null;
    if (card) {
      const logs = await AnalyticsLog.find({ cardId: card._id })
        .sort({ timestamp: -1 })
        .limit(500)
        .lean();
      const tapLogs = await AnalyticsLog.countDocuments({ cardId: card._id, action: 'tap' });
      const downloads = await Lead.countDocuments({ cardOwnerId: id });
      const uniqueIps = Array.from(new Set(logs.filter(l => l.ip).map(l => l.ip)));

      analytics = {
        totalTaps: tapLogs,
        tapLogs,
        linkClicks: await AnalyticsLog.countDocuments({ cardId: card._id, action: 'link_click' }),
        vcardDownloads: downloads,
        uniqueVisitors: uniqueIps.length,
        recentActivity: logs.slice(0, 20).map((l) => ({
          action: l.action,
          metadata: l.metadata,
          ip: l.ip,
          timestamp: l.timestamp,
        })),
      };
    }

    return NextResponse.json({
      user,
      profile,
      cards,
      card,
      leads,
      standees,
      analytics,
    });
  } catch (error) {
    console.error('Admin user detail error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/**
 * PATCH /api/admin/users/:id — edit customer credentials (name, email, phone).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const { id } = params;

    const body = await request.json().catch(() => null);
    const parsed = updateCustomerCredentialsSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const data = parsed.data;
    const hasChanges =
      data.name !== undefined || data.email !== undefined || data.phone !== undefined;
    if (!hasChanges) {
      return fail(400, 'BAD_REQUEST', 'Nothing to update');
    }

    const user = await User.findById(id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    if (data.name !== undefined) user.name = data.name;
    if (data.phone !== undefined) user.phone = data.phone;
    if (data.email !== undefined) user.email = data.email.toLowerCase();

    try {
      await user.save();
    } catch (error) {
      // Unique-index race on email collision with another account.
      if ((error as { code?: number }).code === 11000) {
        return fail(409, 'CONFLICT', 'Email is already in use by another account');
      }
      throw error;
    }

    return NextResponse.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Admin user credentials error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const { action, status } = await request.json();
    const { id } = params;

    const user = await User.findById(id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    if (action === 'updateStatus') {
      if (!status || !['active', 'suspended'].includes(status)) {
        return fail(400, 'BAD_REQUEST', 'Invalid status');
      }
      user.status = status;
      await user.save();

      // If suspending, also suspend their card
      if (status === 'suspended') {
        await Card.updateMany(
          { assignedUserId: user._id },
          { status: 'suspended' }
        );
      }

      return NextResponse.json({ user: { _id: user._id, name: user.name, email: user.email, role: user.role, status: user.status } });
    }

    if (action === 'delete') {
      // Soft-remove purchase records so no active assignment outlives the user
      await UserProduct.updateMany({ userId: user._id }, { status: 'removed' });

      // Remove card assignments
      await Card.updateMany(
        { assignedUserId: user._id },
        { assignedUserId: null, userId: null, status: 'unassigned', isActive: false }
      );

      // Remove standees and profile
      await Standee.deleteMany({ userId: user._id });
      await Profile.findOneAndDelete({ userId: user._id });

      // All of this user's media objects (keyed <userId>/...) become
      // unreachable once the account is gone — delete blobs then rows.
      const media = await Media.find({ userId: user._id }).select('key').lean();
      for (const row of media) {
        try {
          await getStorage().deleteObject(row.key);
        } catch (storageErr) {
          console.error(`User media storage delete failed for key=${row.key}:`, storageErr);
        }
      }
      await Media.deleteMany({ userId: user._id });

      // Remove user
      await User.findByIdAndDelete(user._id);

      return NextResponse.json({ success: true });
    }

    return fail(400, 'BAD_REQUEST', 'Invalid action');
  } catch (error) {
    console.error('Admin user update error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
