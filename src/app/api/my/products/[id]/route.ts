import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { fail, ok } from '@/lib/api';
import UserProduct from '@/models/UserProduct';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import ProductTitleLog from '@/models/ProductTitleLog';
import { PRODUCT_CATALOG, type ProductId } from '@/config/products';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';
import { resolveProductTitle } from '@/lib/services/product-title';
import { resolveProductUrls } from '@/lib/services/product-preview';
import { getReviewProductForUser } from '@/lib/services/review-product-eligibility';
import TenantSettings from '@/models/TenantSettings';
import { renameProductTitleInputSchema, sanitizeProductTitle } from '@/lib/validation/product-title';

type Params = { params: { id: string } };

type AssignmentDoc = {
  _id: unknown;
  userId: unknown;
  catalogProductId: Record<string, unknown> | null;
  cardId: unknown;
  standeeId: unknown;
  pendingConfig: Record<string, unknown> | null;
  quantity: number;
  material: string;
  createdAt: unknown;
};

interface LoadedProduct {
  assignment: AssignmentDoc & Record<string, unknown>;
  instance: Record<string, unknown> | null;
  instanceType: 'card' | 'standee' | null;
}

/**
 * Load one assignment plus its resolved instance. Shared by GET and PATCH so
 * both return the exact same product payload shape.
 */
async function loadProductDetail(
  userId: string,
  assignmentId: string
): Promise<LoadedProduct | null> {
  const assignment = (await UserProduct.findOne({
    _id: assignmentId,
    userId,
    status: 'active',
  })
    .populate('catalogProductId', 'name slug category kind imageUrl')
    .lean()) as unknown as AssignmentDoc | null;

  if (!assignment) return null;

  let instance: Record<string, unknown> | null = null;
  let instanceType: 'card' | 'standee' | null = null;

  if (assignment.cardId) {
    instance = (await Card.findById(assignment.cardId)
      .select('cardUid slug routeSlug urlAlias name cardLabel kind redirectUrl setupComplete isActive instagramConfig whatsappConfig linkedinConfig facebookConfig reviewAssistant publicSlug')
      .lean()) as unknown as Record<string, unknown> | null;
    instanceType = 'card';
  } else if (assignment.standeeId) {
    instance = (await Standee.findById(assignment.standeeId)
      .select('name displayName routeSlug productKey maxProfiles fixedProfiles panelQr socialQrs zones publicSlug')
      .lean()) as unknown as Record<string, unknown> | null;
    instanceType = 'standee';
  } else if (assignment.pendingConfig) {
    // Uninstantiated assignment — the physical card/standee is not bound yet,
    // so the saved config lives on pendingConfig. Synthesize an instance shape
    // from it so the configuration editor renders exactly like a bound product.
    const pending = assignment.pendingConfig;
    const category = (assignment.catalogProductId?.category as string | undefined) ?? '';
    if (category === 'card') {
      instanceType = 'card';
      instance = {
        _id: null,
        name: '',
        routeSlug: '',
        setupComplete: false,
        isActive: false,
        kind: assignment.catalogProductId?.kind,
        cardLabel: (pending.cardLabel as string | undefined) ?? '',
        redirectUrl: (pending?.redirectUrl as string | undefined) ?? '',
        instagramConfig: pending.instagramConfig ?? undefined,
        whatsappConfig: pending.whatsappConfig ?? undefined,
        linkedinConfig: pending.linkedinConfig ?? undefined,
        facebookConfig: pending.facebookConfig ?? undefined,
        reviewAssistant: pending.reviewAssistant ?? undefined,
      };
    } else if (category === 'standee') {
      instanceType = 'standee';
      instance = {
        _id: null,
        name: '',
        routeSlug: '',
        setupComplete: false,
        isActive: false,
        displayName: (pending.displayName as string | undefined) ?? '',
        socialQrs: [],
      };
    }
  }

  return { assignment: assignment as AssignmentDoc & Record<string, unknown>, instance, instanceType };
}

function buildProductPayload({ assignment, instance, instanceType }: LoadedProduct) {
  const catalog = assignment.catalogProductId as Record<string, unknown> | null;
  const slug = (catalog?.slug as string) ?? '';
  const productId: ProductId | null = resolveCanonicalProductId(slug);
  const productDef = productId ? PRODUCT_CATALOG[productId] : null;
  const routeSlug = (instance?.routeSlug as string | undefined) ?? '';

  return {
    assignmentId: assignment._id,
    // Canonical display title — custom name when set, catalog template name
    // otherwise. All My Products UI renders this field.
    productTitle: resolveProductTitle({
      instanceType,
      hasInstance: Boolean(instance),
      card: instanceType === 'card' ? instance : null,
      standee: instanceType === 'standee' ? instance : null,
      pending: assignment.pendingConfig ?? null,
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
}

async function buildProductPayloadWithUrls(loaded: LoadedProduct) {
  const payload = buildProductPayload(loaded);
  const urls = await resolveProductUrls({
    instanceType: loaded.instanceType,
    instance: loaded.instance,
  });

  // Additive Premium/profile review action. The canonical NFC destination is
  // unchanged; this only exposes an explicit review page when the product is
  // review-entitled. Existing review cards keep using their canonical URL.
  let review: {
    eligible: boolean;
    cardKind: string;
    url: string | null;
    published: boolean;
    centralSettingsState: 'valid' | 'invalid' | 'missing';
    centralPublicActive: boolean;
    googleConfigured: boolean;
    aiConfigured: boolean;
    managementUrl: string;
  } | null = null;
  if (
    loaded.instanceType === 'card' &&
    (loaded.instance?.urlAlias || loaded.instance?.slug)
  ) {
    try {
      const lookup = await getReviewProductForUser(
        String(loaded.assignment.userId),
        String(loaded.assignment._id)
      );
      if (lookup.ok && lookup.product.eligible) {
        let aiConfigured = false;
        try {
          const settings = await TenantSettings.findOne({ userId: loaded.assignment.userId })
            .select('openai.enabled openai.apiKeyEnc')
            .lean<{ openai?: { enabled?: boolean; apiKeyEnc?: string } } | null>();
          aiConfigured = Boolean(settings?.openai?.enabled && settings.openai.apiKeyEnc);
        } catch {
          // AI status is informational; never block the product page.
        }
        review = {
          eligible: true,
          cardKind: lookup.product.cardKind,
          url: lookup.product.previewUrl,
          published: lookup.product.reviewAssistantEnabled,
          centralSettingsState: lookup.product.centralSettingsState,
          centralPublicActive: lookup.product.centralPublicActive,
          googleConfigured: lookup.product.googleDestinationConfigured,
          aiConfigured,
          managementUrl: `/dashboard/review-management?cardId=${encodeURIComponent(String(loaded.assignment.cardId))}`,
        };
      }
    } catch {
      // Review availability must never block product configuration.
    }
  }

  return {
    ...payload,
    canonicalPublicUrl: urls.canonicalPublicUrl,
    previewUrl: urls.previewUrl,
    configurationStatus: urls.configurationStatus,
    review,
  };
}

/**
 * GET /api/my/products/[id] — get a single product assignment with instance.
 * Verifies ownership before returning data.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    const loaded = await loadProductDetail(user._id.toString(), params.id);
    if (!loaded) {
      return fail(404, 'NOT_FOUND', 'Product assignment not found');
    }

    return ok({ product: await buildProductPayloadWithUrls(loaded) });
  } catch (error) {
    console.error('Product detail GET error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

/**
 * PATCH /api/my/products/[id] — rename a product assignment.
 *
 * The custom title becomes the product's primary label everywhere in the CRM
 * (`productTitle`). It is written to the backing field by instance type:
 * Card → `cardLabel`, Standee → `displayName`, uninstantiated → `pendingConfig`.
 * An empty title resets the product to its catalog template name. Every rename
 * is recorded in ProductTitleLog.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth(request);
    if (!user) return fail(401, 'UNAUTHORIZED', 'Unauthorized');

    await connectDB();

    const body = await request.json().catch(() => null);
    const parsed = renameProductTitleInputSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Validation failed', parsed.error.flatten().fieldErrors);
    }

    const assignment = (await UserProduct.findOne({
      _id: params.id,
      userId: user._id,
      status: 'active',
    })
      .populate('catalogProductId', 'name slug category kind')
      .lean()) as unknown as {
      _id: unknown;
      cardId: unknown;
      standeeId: unknown;
      pendingConfig: Record<string, unknown> | null;
      catalogProductId: { name?: string; category?: string } | null;
    } | null;

    if (!assignment) {
      return fail(404, 'NOT_FOUND', 'Product assignment not found');
    }

    const category = assignment.catalogProductId?.category ?? '';
    if (category !== 'card' && category !== 'standee') {
      return fail(400, 'BAD_REQUEST', 'This product cannot be renamed');
    }

    // Resolve the requested title. Empty input (after sanitization) resets the
    // product back to its catalog template name.
    const raw = parsed.data.title ?? parsed.data.name ?? '';
    const baseName = assignment.catalogProductId?.name ?? 'Product';
    const requested = sanitizeProductTitle(raw);
    const finalTitle = requested || baseName;

    const catalogName = baseName;
    const loaded = await loadProductDetail(user._id.toString(), params.id);
    const previousTitle = loaded
      ? resolveProductTitle({
          instanceType: loaded.instanceType,
          hasInstance: Boolean(loaded.instance),
          card: loaded.instanceType === 'card' ? loaded.instance : null,
          standee: loaded.instanceType === 'standee' ? loaded.instance : null,
          pending: assignment.pendingConfig,
          catalogName,
        })
      : baseName;

    const instanceType = assignment.cardId ? 'card' : assignment.standeeId ? 'standee' : category;
    let instanceId: string | null = null;

    if (assignment.cardId) {
      const card = await Card.findById(assignment.cardId);
      if (!card) return fail(404, 'NOT_FOUND', 'Physical card not found');
      card.cardLabel = finalTitle;
      await card.save();
      instanceId = card._id.toString();
    } else if (assignment.standeeId) {
      const standee = await Standee.findById(assignment.standeeId);
      if (!standee) return fail(404, 'NOT_FOUND', 'Standee not found');
      standee.displayName = finalTitle;
      await standee.save();
      instanceId = standee._id.toString();
    } else {
      const pending = assignment.pendingConfig ?? {};
      if (instanceType === 'card') {
        pending.cardLabel = finalTitle;
      } else {
        pending.displayName = finalTitle;
      }
      await UserProduct.updateOne(
        { _id: assignment._id },
        { $set: { pendingConfig: pending } }
      );
    }

    // Record the rename in the audit trail. Best-effort: the rename itself has
    // already persisted, so a logging failure must not surface as a failed
    // rename (the customer would retry and double-apply).
    try {
      await ProductTitleLog.create({
        userId: user._id,
        userProductId: assignment._id,
        instanceType: instanceType === 'standee' ? 'standee' : 'card',
        instanceId: instanceId ?? null,
        previousTitle,
        newTitle: finalTitle,
        source: 'customer',
      });
    } catch (error) {
      console.error('ProductTitleLog write failed:', error);
    }

    const reloaded = await loadProductDetail(user._id.toString(), params.id);
    if (!reloaded) {
      return fail(404, 'NOT_FOUND', 'Product assignment not found');
    }

    return ok({ product: await buildProductPayloadWithUrls(reloaded) });
  } catch (error) {
    console.error('Product rename PATCH error:', error);
    return fail(500, 'INTERNAL_ERROR', 'Internal server error');
  }
}