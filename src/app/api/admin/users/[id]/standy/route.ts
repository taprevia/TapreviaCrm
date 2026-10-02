import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import User from '@/models/User';
import Standee from '@/models/Standee';
import { generateQrId } from '@/lib/utils';
import { STANDEE_PLATFORMS, getStandeePlatformById } from '@/lib/constants';

type Params = { params: { id: string } };

function buildSocialQrs(platforms: string[]) {
  return platforms.map((platform) => ({
    qrId: generateQrId(),
    platform,
    qrColor: '#000000',
    label: getStandeePlatformById(platform)?.name ?? platform,
  }));
}

/** POST /api/admin/users/[id]/standy — add a standee (upgrade or additional unit). */
export async function POST(
  request: NextRequest,
  { params }: Params
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const body = await request.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body?.platforms)
      ? body.platforms
      : STANDEE_PLATFORMS.map((p) => p.id);
    const validPlatforms = Array.from(new Set(requested.filter((p) => getStandeePlatformById(p))));

    const standee = await Standee.create({
      userId: user._id,
      panelQr: { qrId: generateQrId(), qrColor: '#000000' },
      socialQrs: buildSocialQrs(validPlatforms),
    });

    user.hasStandy = true;
    await user.save();

    return NextResponse.json({ standee }, { status: 201 });
  } catch (error) {
    console.error('Admin standy upgrade error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** DELETE /api/admin/users/[id]/standy — remove one standee ({ standeeId }). */
export async function DELETE(
  request: NextRequest,
  { params }: Params
) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const { standeeId } = await request.json().catch(() => ({}));
    if (!standeeId) {
      return fail(400, 'BAD_REQUEST', 'standeeId is required');
    }

    await Standee.deleteOne({ _id: standeeId, userId: user._id });

    const remaining = await Standee.countDocuments({ userId: user._id });
    if (remaining === 0 && user.hasStandy) {
      user.hasStandy = false;
      await user.save();
    }

    return NextResponse.json({ success: true, remainingStandees: remaining });
  } catch (error) {
    console.error('Admin standy delete error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
