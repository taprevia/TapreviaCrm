import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import User from '@/models/User';
import CatalogProduct from '@/models/CatalogProduct';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { deleteStandeeCascade } from '@/lib/services/standee-deletion';
import { objectIdSchema } from '@/lib/validation/common';
import { addStandeeSchema, deleteStandeeSchema } from '@/lib/validation/catalog';

type Params = { params: { id: string } };

/**
 * POST /api/admin/users/[id]/standy — add a standee (upgrade or additional unit).
 *
 * Canonical path only: every standee is created through `assignUserProduct`,
 * so it systematically receives its `routeSlug`, `publicSlug`, `displayName`,
 * `productKey`, `maxProfiles` and `fixedProfiles`, and is linked to a
 * `UserProduct` assignment. A catalog product id is therefore required.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const idParsed = objectIdSchema.safeParse(params.id);
    if (!idParsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid user id');
    }

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = addStandeeSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    const user = await User.findById(idParsed.data);
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
    if (item.category !== 'standee') {
      return fail(400, 'BAD_REQUEST', 'Selected product is not a standee');
    }

    const result = await assignUserProduct({
      user,
      catalogItem: item,
      quantity: parsed.data.quantity,
      platforms: parsed.data.platforms,
      notes: parsed.data.notes,
      assignedBy: admin.user._id,
    });
    if (!result.ok) {
      return fail(result.status, result.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', result.error);
    }

    return ok({ standee: result.data.standee, userProduct: result.data.userProduct }, 201);
  } catch (error) {
    console.error('Admin standy upgrade error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/** DELETE /api/admin/users/[id]/standy — remove one standee ({ standeeId }). */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    const idParsed = objectIdSchema.safeParse(params.id);
    if (!idParsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid user id');
    }

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = deleteStandeeSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    const user = await User.findById(idParsed.data);
    if (!user) {
      return fail(404, 'NOT_FOUND', 'User not found');
    }

    const result = await deleteStandeeCascade(parsed.data.standeeId, {
      userId: idParsed.data,
    });
    if (!result.ok) {
      return fail(result.status, 'NOT_FOUND', result.error);
    }

    return NextResponse.json({
      success: true,
      remainingStandees: result.remainingStandees,
    });
  } catch (error) {
    console.error('Admin standy delete error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
