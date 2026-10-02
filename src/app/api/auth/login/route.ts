import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import { generateToken, setAuthCookie } from '@/lib/auth';
import { check } from '@/lib/rate-limit';
import { fail } from '@/lib/api';
import { loginSchema } from '@/lib/validation/auth';

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;



export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const limit = await check(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many login attempts, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { email, password } = parsed.data;

    await connectDB();
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return fail(401, 'UNAUTHORIZED', 'Invalid credentials');
    }
    if (user.status === 'suspended') {
      return fail(403, 'FORBIDDEN', 'Account suspended');
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return fail(401, 'UNAUTHORIZED', 'Invalid credentials');
    }

    const token = generateToken(user._id.toString(), user.role);
    const response = NextResponse.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });

    return setAuthCookie(response, token);
  } catch (error) {
    console.error('Login error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
