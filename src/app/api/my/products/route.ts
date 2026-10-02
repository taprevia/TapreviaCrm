import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import UserProduct from '@/models/UserProduct';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import { PRODUCT_CATALOG, type ProductId, isProductId } from '@/config/products';
import { resolveProductTitle } from '@/lib/services/product-title';

export const dynamic = 'force-dynamic';

// GET /api/my/products — list customer's owned products with configuration status.
export async function GET(request: NextRequest) {
  try {
    const me = await requireAuth(request);
    if (!me) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();
    const assignResult = await UserProduct.find({ userId: me._id, status: 'active' })
      .populate('catalogProductId', 'name slug category kind imageUrl priceMinor currency active')
      .sort({ createdAt: -1 })
      .lean();
    const assignments = Array.isArray(assignResult) ? assignResult : [];

    // Batch-fetch all card/standee instances in two queries instead of one
    // per assignment (N+1).
    const cardIds = assignments
      .map((a) => a.cardId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));
    const standeeIds = assignments
      .map((a) => a.standeeId)
      .filter((id): id is NonNullable<typeof id> => Boolean(id));

    const CARD_SELECT =
      'cardUid slug routeSlug urlAlias name cardLabel kind redirectUrl setupComplete isActive instagramConfig whatsappConfig linkedinConfig facebookConfig reviewAssistant publicSlug';
    const STANDEE_SELECT =
      'name displayName routeSlug productKey maxProfiles fixedProfiles panelQr socialQrs zones publicSlug';

    const [cards, standees] = await Promise.all([
      cardIds.length
        ? Card.find({ _id: { $in: cardIds } })
            .select(CARD_SELECT)
            .lean()
        : [],
      standeeIds.length
        ? Standee.find({ _id: { $in: standeeIds } })
            .select(STANDEE_SELECT)
            .lean()
        : [],
    ]);

    const cardMap = new Map(
      (cards as Array<Record<string, unknown>>).map((c) => [String(c._id), c])
    );
    const standeeMap = new Map(
      (standees as Array<Record<string, unknown>>).map((s) => [String(s._id), s])
    );

    // Enrich each assignment with product instance data.
    const enriched = assignments.map((assignment: Record<string, unknown>) => {
        const catalog = assignment.catalogProductId as Record<string, unknown> | null;
        const slug = (catalog?.slug as string) ?? '';
        const productId: ProductId | null = isProductId(slug?.toUpperCase()?.replace(/-/g, '_'))
          ? (slug.toUpperCase().replace(/-/g, '_') as ProductId)
          : null;
        const productDef = productId ? PRODUCT_CATALOG[productId] : null;

        let instance: Record<string, unknown> | null = null;
        let instanceType: 'card' | 'standee' | null = null;

        if (assignment.cardId) {
          instance = cardMap.get(String(assignment.cardId)) ?? null;
          instanceType = 'card';
        } else if (assignment.standeeId) {
          instance = standeeMap.get(String(assignment.standeeId)) ?? null;
          instanceType = 'standee';
        } else if (catalog?.category === 'card') {
          // Uninstantiated card assignment — no physical card bound yet. Mirror
          // the single-product endpoint's synthesized instanceType so the My
          // Products UI surfaces "Setup Required"/"Set Up" consistently with the
          // configuration page. The instance itself stays null: configuration
          // synthesis remains the single-product GET's concern.
          instanceType = 'card';
        } else if (catalog?.category === 'standee') {
          // Uninstantiated standee assignment — same contract as above so its
          // productTitle (pendingConfig.displayName) resolves in the list too.
          instanceType = 'standee';
        }

        const routeSlug = (instance?.routeSlug as string | undefined) ?? '';

        return {
          assignmentId: assignment._id,
          // Canonical display title — custom name when set, catalog template
          // name otherwise. All My Products UI renders this field.
          productTitle: resolveProductTitle({
            instanceType,
            hasInstance: Boolean(instance),
            card: instanceType === 'card' ? instance : null,
            standee: instanceType === 'standee' ? instance : null,
            pending: (assignment.pendingConfig as Record<string, unknown> | null) ?? null,
            catalogName: (catalog?.name as string | undefined) ?? '',
          }),
          catalogProduct: catalog
            ? {
                id: catalog._id,
                name: catalog.name,
                slug: catalog.slug,
                category: catalog.category,
                kind: catalog.kind,
                imageUrl: catalog.imageUrl,
              }
            : null,
          productDef: productDef
            ? {
                id: productDef.id,
                name: productDef.name,
                category: productDef.category,
                metadata: productDef.metadata,
              }
            : null,
          instanceType,
          // Human-readable public URL ("/{business-slug}/{product-slug}[-N]").
          // Cards and standees with an allocated publicSlug expose one;
          // uninstantiated/unbound instances keep null.
          publicUrl:
            instance && typeof instance.publicSlug === 'string' && instance.publicSlug
              ? `/${instance.publicSlug}`
              : null,
          instance: instance
            ? {
                id: instance._id,
                name: instance.name,
                routeSlug,
                setupComplete: instance.setupComplete,
                isActive: instance.isActive,
                // Card-specific
                ...(instanceType === 'card'
                  ? {
                      cardUid: instance.cardUid,
                      urlAlias: instance.urlAlias,
                      kind: instance.kind,
                      cardLabel: instance.cardLabel,
                      redirectUrl: instance.redirectUrl,
                      instagramConfig: instance.instagramConfig,
                      whatsappConfig: instance.whatsappConfig,
                      linkedinConfig: instance.linkedinConfig,
                      facebookConfig: instance.facebookConfig,
                      reviewAssistant: instance.reviewAssistant,
                    }
                  : {}),
                // Standee-specific
                ...(instanceType === 'standee'
                  ? {
                      productKey: instance.productKey,
                      displayName: instance.displayName,
                      maxProfiles: instance.maxProfiles,
                      fixedProfiles: instance.fixedProfiles,
                      panelQr: instance.panelQr,
                      socialQrs: instance.socialQrs,
                      zones: instance.zones,
                    }
                  : {}),
              }
            : null,
          quantity: assignment.quantity,
          material: assignment.material,
          createdAt: assignment.createdAt,
        };
      });

    return ok({ products: enriched });
  } catch (error) {
    console.error('My products GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}
