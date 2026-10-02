import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { fail, ok, parsePagination } from '@/lib/api';
import { getOwnedCard } from '@/lib/services/card-access';
import { createProductSchema } from '@/lib/validation/product';
import Product from '@/models/Product';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

const MAX_PRODUCTS_PER_CARD = 30;

// GET /api/cards/[id]/products
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    const sp = new URL(request.url).searchParams;
    const { page, limit, skip } = parsePagination(sp);

    const filter: Record<string, unknown> = { cardId: result.card._id };

    const activeRaw = sp.get('active');
    if (activeRaw !== null) {
      if (activeRaw !== 'true' && activeRaw !== 'false') {
        return fail(400, 'VALIDATION_ERROR', 'Invalid active filter');
      }
      filter.active = activeRaw === 'true';
    }

    const category = sp.get('category')?.trim();
    if (category) filter.category = category;

    const [docs, total] = await Promise.all([
      Product.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return ok({
      items: docs,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error('Card products GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// POST /api/cards/[id]/products
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const result = await getOwnedCard(params.id, user);
    if (result.status === 'not_found') return fail(404, 'NOT_FOUND', 'Card not found');
    if (result.status === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');
    const cardId = result.card._id;

    const body = await request.json().catch(() => null);
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    const count = await Product.countDocuments({ cardId });
    if (count >= MAX_PRODUCTS_PER_CARD) {
      return fail(403, 'QUOTA', `Product limit reached (${MAX_PRODUCTS_PER_CARD})`);
    }

    const product = await Product.create({
      ...parsed.data,
      userId: user._id,
      cardId,
    });

    return ok({ product }, 201);
  } catch (error) {
    console.error('Card products POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
