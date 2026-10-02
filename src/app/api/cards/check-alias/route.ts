import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ok, fail } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import Card from '@/models/Card';

export const dynamic = 'force-dynamic';

const ALIAS_FORMAT_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

const RESERVED_ALIASES = [
  'admin',
  'api',
  'login',
  'register',
  'dashboard',
  'profile',
  'c',
  't',
  'media',
  'assets',
  'static',
];

// GET /api/cards/check-alias?alias=&excludeId= — availability probe
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    const limit = await check(`alias:${user._id}`, 60, 60_000);
    if (!limit.success) {
      const res = fail(429, 'RATE_LIMITED', 'Too many requests');
      res.headers.set('Retry-After', String(limit.retryAfterSec));
      return res;
    }

    const sp = new URL(request.url).searchParams;
    const alias = (sp.get('alias') ?? '').trim().toLowerCase();
    const excludeIdRaw = (sp.get('excludeId') ?? '').trim();

    if (!ALIAS_FORMAT_RE.test(alias)) {
      return ok({ available: false, reason: 'INVALID' });
    }
    if (RESERVED_ALIASES.includes(alias)) {
      return ok({ available: false, reason: 'RESERVED' });
    }

    await connectDB();

    const query: Record<string, unknown> = { urlAlias: alias };
    if (/^[0-9a-fA-F]{24}$/.test(excludeIdRaw)) {
      query._id = { $ne: new mongoose.Types.ObjectId(excludeIdRaw) };
    }

    const taken = await Card.exists(query);
    if (!taken) return ok({ available: true });

    return ok({
      available: false,
      suggestion: `${alias}-${randomBytes(2).toString('hex')}`,
    });
  } catch (error) {
    console.error('Check-alias GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
