import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail } from '@/lib/api';
import User from '@/models/User';
import { adminResetPasswordSchema } from '@/lib/validation/catalog';
import { mintResetToken } from '@/lib/password-reset';
import { sendPasswordResetEmail } from '@/lib/mail';

/**
 * POST /api/admin/users/:id/reset-password
 *
 * Admin-initiated password recovery. Two modes:
 *  - mode 'email' (default): mints a one-time reset token and emails the
 *    customer a reset link (dev console in non-production).
 *  - mode 'temp': sets the supplied temporary password directly — the User
 *    pre-save hook bcrypt-hashes it before storage.
 *
 * Returns a success shape only (never the raw token/password back); the admin
 * UI tells the customer what to expect.
 */
export async function POST(
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
    const parsed = adminResetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const user = await User.findById(id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }
    if (user.status === 'suspended') {
      return fail(400, 'BAD_REQUEST', 'Cannot reset the password of a suspended account');
    }

    const mode = parsed.data.mode;

    if (mode === 'temp') {
      const password = parsed.data.password;
      if (!password) {
        return fail(400, 'BAD_REQUEST', 'A temporary password is required for temp mode');
      }
      user.passwordHash = password;
      await user.save();
      return NextResponse.json({ success: true, mode: 'temp' });
    }

    const { token } = await mintResetToken(user._id.toString());
    await sendPasswordResetEmail(user.email, token);
    return NextResponse.json({ success: true, mode: 'email' });
  } catch (error) {
    console.error('Admin reset-password error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}