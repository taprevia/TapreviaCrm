import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAdminStrict } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import CatalogProduct from '@/models/CatalogProduct';
import { isHiddenPvcProduct } from '@/lib/marketing/product-visibility';

// GET /api/admin/catalog
// Returns all catalog products (read-only — products are defined in code)
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdminStrict(request);
    if (admin.kind === 'unauthorized') return fail(401, 'UNAUTHORIZED', 'Unauthorized');
    if (admin.kind === 'forbidden') return fail(403, 'FORBIDDEN', 'Forbidden');

    await connectDB();
    const catalog = await CatalogProduct.find().sort({ sortOrder: 1, createdAt: -1 });

    // PVC is legacy-only. Keep historical assignments readable, but never
    // offer a PVC-named catalog item for a new assignment. The rule lives in
    // one shared presentation module so admin and customer surfaces cannot
    // drift apart.
    const visibleCatalog = catalog.filter(
      (item) =>
        !isHiddenPvcProduct({
          slug: item.slug,
          name: item.name,
        })
    );

    return ok({ catalog: visibleCatalog });
  } catch (error) {
    console.error('Admin catalog list error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// POST /api/admin/catalog — DISABLED
// Products are defined in src/config/products.ts, not created via API
export async function POST() {
  return fail(403, 'FORBIDDEN', 'Products are defined in code and cannot be created via API');
}
