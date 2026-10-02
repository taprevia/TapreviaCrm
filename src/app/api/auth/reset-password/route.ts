import { NextRequest } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { check } from '@/lib/rate-limit';
import { fail, ok } from '@/lib/api';
import { resetPasswordSchema } from '@/lib/validation/auth';
import { consumeResetToken } from '@/lib/password-reset';

const RESET_IP_LIMIT = 10;
const RESET_WINDOW_MS = 15 * 60_000;



export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const limit = await check(`reset:${ip}`, RESET_IP_LIMIT, RESET_WINDOW_MS);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many attempts, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { token, newPassword } = parsed.data;

    const result = await consumeResetToken(token, newPassword);
    if (!result.ok) {
      // One message for expired, already-used, and unknown tokens alike.
      return fail(400, 'BAD_REQUEST', 'This password reset link is invalid or has expired');
    }

    return ok({ success: true });
  } catch (error) {
    console.error('Reset password error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}