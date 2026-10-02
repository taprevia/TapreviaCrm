import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import { assignProductSchema } from '@/lib/validation/catalog';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { resolveProductTitle } from '@/lib/services/product-title';
import User from '@/models/User';
import CatalogProduct from '@/models/CatalogProduct';
import UserProduct from '@/models/UserProduct';
import Card from '@/models/Card';
import Standee from '@/models/Standee';

type Params = { params: { id: string } };

// GET /api/admin/users/[id]/products
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const products = await UserProduct.find({ userId: user._id })
      .populate('catalogProductId', 'name category kind imageUrl priceMinor currency active')
      .sort({ createdAt: -1 });

    // Batch-fetch card/standee instances once and resolve each product's
    // canonical display title (custom name when set, catalog name otherwise).
    const cardIds = products.filter((p) => p.cardId).map((p) => p.cardId);
    const standeeIds = products.filter((p) => p.standeeId).map((p) => p.standeeId);
    const [cards, standees] = await Promise.all([
      cardIds.length ? Card.find({ _id: { $in: cardIds } }).select('cardLabel name') : [],
      standeeIds.length
        ? Standee.find({ _id: { $in: standeeIds } }).select('displayName name')
        : [],
    ]);
    const cardMap = new Map<string, (typeof cards)[number]>(
      cards.map((c) => [String(c._id), c])
    );
    const standeeMap = new Map<string, (typeof standees)[number]>(
      standees.map((s) => [String(s._id), s])
    );

    const enriched = products.map((p) => {
      const catalog = p.catalogProductId as unknown as {
        category?: string;
        name?: string;
      } | null;
      const category = catalog?.category ?? '';
      const card = p.cardId ? cardMap.get(String(p.cardId)) ?? null : null;
      const standee = p.standeeId ? standeeMap.get(String(p.standeeId)) ?? null : null;
      // Category is authoritative for what the assignment IS — it also covers
      // uninstantiated (pending) assignments that have no bound instance yet.
      const instanceType = category === 'card'
        ? 'card'
        : category === 'standee'
          ? 'standee'
          : null;

      return {
        ...p.toObject(),
        instanceType,
        productTitle: resolveProductTitle({
          instanceType,
          hasInstance: Boolean(card || standee),
          card,
          standee,
          pending: p.pendingConfig,
          catalogName: catalog?.name ?? '',
        }),
      };
    });

    return ok({ products: enriched });
  } catch (error) {
    console.error('Admin user products GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// POST /api/admin/users/[id]/products
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const body = await request.json().catch(() => null);
    const parsed = assignProductSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const item = await CatalogProduct.findById(parsed.data.catalogProductId);
    if (!item) {
      return fail(404, 'NOT_FOUND', 'Catalog product not found');
    }
    if (!item.active) {
      return fail(400, 'BAD_REQUEST', 'Catalog product is inactive');
    }

    const result = await assignUserProduct({
      user,
      catalogItem: item,
      quantity: parsed.data.quantity,
      cardUid: parsed.data.cardUid,
      platforms: parsed.data.platforms,
      notes: parsed.data.notes,
      assignedBy: admin.user._id,
      material: parsed.data.material,
    });
    if (!result.ok) {
      return fail(result.status, result.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', result.error);
    }

    return ok(result.data, 201);
  } catch (error) {
    console.error('Admin user products POST error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// DELETE /api/admin/users/[id]/products
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const body = await request.json().catch(() => ({}));
    const { userProductId } = body ?? {};
    if (!userProductId) {
      return fail(400, 'BAD_REQUEST', 'userProductId is required');
    }

    const user = await User.findById(params.id);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const removed = await UserProduct.findOneAndUpdate(
      { _id: userProductId, userId: user._id },
      { status: 'removed' },
      { new: true }
    );
    if (!removed) {
      return fail(404, 'NOT_FOUND', 'User product not found');
    }

    return ok({ success: true });
  } catch (error) {
    console.error('Admin user products DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
