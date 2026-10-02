import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import Card, { DEFAULT_BUSINESS_HOURS } from '@/models/Card';
import { createCardSchema } from '@/lib/validation/card';
import { fail, ok, parsePagination } from '@/lib/api';
import { generateSlug } from '@/lib/utils';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

export const dynamic = 'force-dynamic';

const MAX_CARDS_PER_USER = 5;

// GET /api/cards — list the current user's cards
export async function GET(request: NextRequest) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const ownership = [{ userId: user._id }, { assignedUserId: user._id }];
    const filter: Record<string, unknown> = {};
    const search = sp.get('search');
    if (search) {
      filter.$and = [
        { $or: ownership },
        {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { urlAlias: { $regex: search, $options: 'i' } },
          ],
        },
      ];
    } else {
      filter.$or = ownership;
    }

    const [cards, total] = await Promise.all([
      Card.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          'name cardLabel urlAlias templateKey isActive profileImageUrl stats status assignedUserId createdAt updatedAt publicSlug'
        )
        .lean(),
      Card.countDocuments(filter),
    ]);

    return ok({
      cards,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Cards GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// POST /api/cards — create a card (admin provisioning only)
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    // Customers receive cards from their business; creation is admin-only.
    if (user.role !== 'admin') {
      return fail(403, 'FORBIDDEN', 'Cards are provisioned by your business');
    }

    const body = await request.json().catch(() => null);
    const parsed = createCardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    await connectDB();

    const count = await Card.countDocuments({ userId: user._id });
    if (count >= MAX_CARDS_PER_USER) {
      return fail(403, 'FORBIDDEN', `You have reached the maximum of ${MAX_CARDS_PER_USER} cards`);
    }

    let alias = parsed.data.urlAlias;
    if (alias) {
      const existing = await Card.findOne({ urlAlias: alias }).lean();
      if (existing) return fail(409, 'CONFLICT', 'This alias is already taken');
    } else {
      const base = generateSlug(parsed.data.name) || 'card';
      alias = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const card = await Card.create({
      userId: user._id,
      cardUid: `DIGITAL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      slug: alias,
      name: parsed.data.name,
      urlAlias: alias,
      templateKey: parsed.data.templateKey ?? DEFAULT_TEMPLATE_KEY,
      businessHours: DEFAULT_BUSINESS_HOURS.map((d) => ({ ...d })),
    });

    return ok({ card }, 201);
  } catch (error) {
    console.error('Cards POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
