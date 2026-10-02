import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/request-ip';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Profile from '@/models/Profile';
import { generateToken, setAuthCookie } from '@/lib/auth';
import { check } from '@/lib/rate-limit';
import { fail } from '@/lib/api';
import { registerSchema } from '@/lib/validation/auth';
import { ensureUserBizSlug } from '@/lib/services/human-url';

const REGISTER_LIMIT = 10;
const REGISTER_WINDOW_MS = 15 * 60_000;



export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request);
    const limit = await check(`register:${ip}`, REGISTER_LIMIT, REGISTER_WINDOW_MS);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many registration attempts, please try again shortly');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const body = await request.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }
    const { name, email, password } = parsed.data;

    await connectDB();
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return fail(409, 'CONFLICT', 'Email already registered');
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash: password,
      role: 'customer',
    });

    await Profile.create({
      userId: user._id,
      personalInfo: { fullName: name },
    });

    // Assign the account's company profile slug (Part B). Idempotent — a later
    // company-name change never regenerates it (Part D).
    await ensureUserBizSlug(user, user.name);

    const token = generateToken(user._id.toString(), user.role);
    const response = NextResponse.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    }, { status: 201 });

    return setAuthCookie(response, token);
  } catch (error) {
    console.error('Registration error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
