import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import User from '@/models/User';
import { fail, ok } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validation/auth';

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    }

    await connectDB();
    const body = await request.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { currentPassword, newPassword } = parsed.data;

    const fullUser = await User.findById(user._id);
    if (!fullUser) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const isValid = await fullUser.comparePassword(currentPassword);
    if (!isValid) {
      return fail(400, 'BAD_REQUEST', 'Current password is incorrect');
    }

    fullUser.passwordHash = newPassword;
    await fullUser.save();

    return ok({ success: true });
  } catch (error) {
    console.error('Password change error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
