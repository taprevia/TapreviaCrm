import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireApiEntitlement } from '@/lib/auth/capability-guard';
import { fail, ok } from '@/lib/api';
import { objectIdSchema } from '@/lib/validation/common';
import { updateProductSchema } from '@/lib/validation/product';
import Product from '@/models/Product';
import Media from '@/models/Media';
import { getStorage } from '@/lib/storage';

type Params = { params: { id: string } };

/**
 * Load a product enforcing ownership (admins bypass).
 * Invalid ids and missing docs both map to 404 — never leak existence.
 */
async function getOwnedProduct(id: string, userId: string, role: string) {
  const parsed = objectIdSchema.safeParse(id);
  if (!parsed.success) return null;

  const product = await Product.findById(parsed.data);
  if (!product) return null;

  if (product.userId.toString() !== userId && role !== 'admin') return 'forbidden' as const;
  return product;
}

// PATCH /api/products/[id] — partial update of an owned product
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const product = await getOwnedProduct(params.id, user._id, user.role);
    if (!product) return fail(404, 'NOT_FOUND', 'Product not found');
    if (product === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    const body = await request.json().catch(() => null);
    const parsed = updateProductSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid input', parsed.error.flatten().fieldErrors);
    }

    // Apply only keys the client actually sent. Under zod v4, fields with
    // `.default()` (currency/active) surface their default on absent keys even
    // through `.partial()` — filtering by raw-body presence prevents a narrow
    // patch from resetting them to defaults.
    const rawKeys = new Set(
      typeof body === 'object' && body !== null ? Object.keys(body as object) : []
    );
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined && rawKeys.has(key)) {
        (product as unknown as Record<string, unknown>)[key] = value;
      }
    }

    // Image replaced or cleared: the previously stored media is now detached —
    // remove its record AND its object so nothing is orphaned in the bucket.
    const previousImageUrl = product.imageUrl ?? '';
    if (
      rawKeys.has('imageUrl') &&
      parsed.data.imageUrl !== undefined &&
      parsed.data.imageUrl !== previousImageUrl
    ) {
      await deleteOwnedMedia(previousImageUrl, user._id);
    }

    await product.save();
    return ok({ product });
  } catch (error) {
    console.error('Product PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// DELETE /api/products/[id] — remove an owned product
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { status: authStatus, user } = await requireApiEntitlement(request, 'profile_edit');
    if (authStatus === 401) return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (authStatus === 403) return fail(403, 'FORBIDDEN', 'Your products do not include vCards');

    await connectDB();
    const product = await getOwnedProduct(params.id, user._id, user.role);
    if (!product) return fail(404, 'NOT_FOUND', 'Product not found');
    if (product === 'forbidden') return fail(403, 'FORBIDDEN', 'Not allowed');

    // Best-effort cleanup of the media row AND its stored object when the
    // image is one of ours. Deleting the blob is what prevents bucket orphans.
    await deleteOwnedMedia(product.imageUrl ?? '', user._id);

    await product.deleteOne();

    return ok({ success: true });
  } catch (error) {
    console.error('Product DELETE error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/**
 * Best-effort removal of a `/media/<key>` image: the storage object first
 * (that's what frees bucket bytes), then the Media row. Scoped to owned
 * media; deleting an already-gone key is a no-op.
 */
async function deleteOwnedMedia(url: string, userId: unknown): Promise<void> {
  if (!url.startsWith('/media/')) return;
  const key = url.slice('/media/'.length);
  if (!key) return;

  try {
    await getStorage().deleteObject(key);
  } catch (storageErr) {
    console.error(`Product image storage delete failed for key=${key}:`, storageErr);
  }

  try {
    await Media.deleteOne({ key, userId });
  } catch (mediaErr) {
    console.error('Product image media cleanup failed:', mediaErr);
  }
}
