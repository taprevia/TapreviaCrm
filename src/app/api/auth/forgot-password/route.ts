import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { createHash } from 'crypto';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import { forgotPasswordSchema } from '@/lib/validation/auth';
import { mintResetToken } from '@/lib/password-reset';
import { sendPasswordResetEmail } from '@/lib/mail';

const FORGOT_IP_LIMIT = 10;
const FORGOT_EMAIL_LIMIT = 3;
const FORGOT_WINDOW_MS = 15 * 60_000;



export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const ipLimit = await check(`forgot:${ip}`, FORGOT_IP_LIMIT, FORGOT_WINDOW_MS);
    if (!ipLimit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests, please try again shortly');
      res.headers.set('Retry-After', String(ipLimit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { email } = parsed.data;

    await connectDB();

    // Per-email throttling keyed on a hash of the address — never rate-limit
    // an account into visibility. Denied requests still return the generic
    // success so an attacker cannot distinguish a hitting-limit email.
    const emailKey = createHash('sha256').update(email.toLowerCase()).digest('hex');
    const emailLimit = await check(`forgot:${emailKey}`, FORGOT_EMAIL_LIMIT, FORGOT_WINDOW_MS);
    if (!emailLimit.success) {
      return ok({ success: true });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('_id email status');
    if (user && user.status !== 'suspended') {
      const { token } = await mintResetToken(user._id.toString());
      await sendPasswordResetEmail(user.email, token);
    }

    return ok({ success: true });
  } catch (error) {
    console.error('Forgot password error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}