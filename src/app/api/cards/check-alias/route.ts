import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ok, fail, rateLimitFailure } from '@/lib/api';
import { check } from '@/lib/rate-limit';
import { validateAlias } from '@/lib/validation/common';
import Card from '@/models/Card';

export const dynamic = 'force-dynamic';

// GET /api/cards/check-alias?alias=&excludeId= — availability probe
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    const limit = await check(`alias:${user._id}`, 60, 60_000);
    const limited = rateLimitFailure(limit, 'Too many requests');
    if (limited) return limited;

    const sp = new URL(request.url).searchParams;
    const validated = validateAlias(sp.get('alias') ?? '');
    if (!validated.ok) {
      return ok({ available: false, reason: validated.reason });
    }
    const alias = validated.value;
    const excludeIdRaw = (sp.get('excludeId') ?? '').trim();

    await connectDB();

    // Public handles resolve through BOTH `urlAlias` and `slug` (see
    // getPublicCardByAlias / /c), so availability must check both namespaces.
    const query: Record<string, unknown> = {
      $or: [{ urlAlias: alias }, { slug: alias }],
    };
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
