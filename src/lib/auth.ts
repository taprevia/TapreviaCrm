import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from './db';
import User from '@/models/User';
import { requireJwtSecret } from './env';

const JWT_SECRET = requireJwtSecret();
const TOKEN_EXPIRY = '7d';
const COOKIE_NAME = 'token';

export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  role: string;
  status?: string;
  customerId?: string;
  bizSlug?: string | null;
  phone?: string;
  isNewsletterEnabled?: boolean;
}

export function generateToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): { userId: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
  } catch {
    return null;
  }
}

export function setAuthCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}

export function clearAuthCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const verified = verifyToken(token);
  if (!verified) return null;

  await connectDB();
  const user = await User.findById(verified.userId).select('-passwordHash');
  if (!user) return null;
  if (user.status === 'suspended') return null;
  return {
    _id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    customerId: user.customerId,
    bizSlug: user.bizSlug,
    phone: user.phone,
    isNewsletterEnabled: user.isNewsletterEnabled,
  };
}

export async function requireAuth(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return null;
  }
  return user;
}

export async function requireAdmin(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user || user.role !== 'admin') {
    return null;
  }
  return user;
}

export type AdminCheck =
  | { kind: 'ok'; user: AuthUser }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' };

/**
 * Discriminated admin check so routes can distinguish "no session" (401)
 * from "authenticated but not admin" (403).
 */
export async function requireAdminStrict(request: NextRequest): Promise<AdminCheck> {
  const user = await getAuthUser(request);
  if (!user) return { kind: 'unauthorized' };
  if (user.role !== 'admin') return { kind: 'forbidden' };
  return { kind: 'ok', user };
}
