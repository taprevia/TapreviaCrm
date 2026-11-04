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
import { resolveCardPreview } from '@/lib/services/product-preview';
import { allocateCardRouteSlug } from '@/lib/services/card-identity';
import { literalSearchRegExp, normalizeSearchInput } from '@/lib/search';

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
    const normalizedSearch = normalizeSearchInput(sp.get('search'));
    if (!normalizedSearch.ok) {
      return fail(400, 'VALIDATION_ERROR', 'Search term is too long');
    }
    const search = normalizedSearch.value;
    if (search) {
      const regex = literalSearchRegExp(search);
      filter.$and = [
        { $or: ownership },
        {
          $or: [
            { name: { $regex: regex } },
            { urlAlias: { $regex: regex } },
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
          'name cardLabel urlAlias slug publicSlug routeSlug kind redirectUrl reviewAssistant reviewSettingsSource reviewOverrides isActive profileImageUrl stats status userId assignedUserId createdAt updatedAt'
        )
        .lean(),
      Card.countDocuments(filter),
    ]);

    const cardsWithPreview = await Promise.all(
      (cards as Array<Record<string, unknown>>).map(async (card) => ({
        ...card,
        preview: await resolveCardPreview(card as never),
      }))
    );

    return ok({
      cards: cardsWithPreview,
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

    let alias = parsed.data.urlAlias?.trim().toLowerCase();
    if (!alias) {
      const base = generateSlug(parsed.data.name) || 'card';
      alias = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    }

    // The public handle resolves through BOTH urlAlias and slug, so a new
    // alias must not collide with either namespace. `slug` is unique-indexed,
    // which also makes the create atomic against concurrent claims.
    const existing = await Card.findOne({
      $or: [{ urlAlias: alias }, { slug: alias }],
    })
      .select('_id')
      .lean();
    if (existing) return fail(409, 'CONFLICT', 'This alias is already taken');

    // Permanent route identity is allocated at creation and never regenerated.
    const routeSlug = await allocateCardRouteSlug();

    try {
      const card = await Card.create({
        userId: user._id,
        cardUid: `DIGITAL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
        slug: alias,
        name: parsed.data.name,
        urlAlias: alias,
        routeSlug,
        uid: routeSlug,
        templateKey: parsed.data.templateKey ?? DEFAULT_TEMPLATE_KEY,
        businessHours: DEFAULT_BUSINESS_HOURS.map((d) => ({ ...d })),
      });

      return ok({ card }, 201);
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        return fail(409, 'CONFLICT', 'This alias is already taken');
      }
      throw error;
    }
  } catch (error) {
    console.error('Cards POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
