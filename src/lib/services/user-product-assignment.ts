import Card from '@/models/Card';
import Profile from '@/models/Profile';
import Standee from '@/models/Standee';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import { deriveCardKind } from '@/lib/services/product-experience';
import { provisionCardForAssignment } from '@/lib/services/card-identity';
import { ensureCardPublicSlug, ensureStandeePublicSlug } from '@/lib/services/human-url';
import { STANDEE_PLATFORMS, getStandeePlatformById } from '@/lib/constants';
import { generateQrId } from '@/lib/utils';
import { isProductId, getProductDef, getStandeeProfileConfig } from '@/config/products';

type UserDoc = ReturnType<typeof User.hydrate>;
type CatalogProductDoc = ReturnType<typeof CatalogProduct.hydrate>;
type UserProductDoc = ReturnType<typeof UserProduct.hydrate>;
type CardDoc = ReturnType<typeof Card.hydrate>;
type StandeeDoc = ReturnType<typeof Standee.hydrate>;

export interface AssignedProductData {
  userProduct: UserProductDoc;
  card?: CardDoc;
  standee?: StandeeDoc;
  /** True when the physical Card record was created during this call. */
  cardCreated?: boolean;
}

export type AssignUserProductResult =
  | { ok: true; status: 201; data: AssignedProductData }
  | { ok: false; status: number; error: string };

interface AssignUserProductArgs {
  user: UserDoc;
  catalogItem: CatalogProductDoc;
  quantity: number;
  cardUid?: string;
  platforms?: string[];
  notes?: string;
  assignedBy: string;
  material?: 'pvc' | 'metal' | 'wooden';
}

/**
 * Fulfil a catalog purchase for a user. Creates side-effect records per category:
 * cards are atomically claimed and linked to the profile, standees generate panel +
 * social QRs, everything else only records the assignment.
 */
export async function assignUserProduct({
  user,
  catalogItem,
  quantity,
  cardUid,
  platforms,
  notes,
  assignedBy,
  material = 'pvc',
}: AssignUserProductArgs): Promise<AssignUserProductResult> {
  switch (catalogItem.category) {
    case 'card': {
      const derivedKind = deriveCardKind(catalogItem.kind);
      if (!derivedKind) {
        return {
          ok: false,
          status: 400,
          error: `Product kind '${catalogItem.kind}' cannot be allocated to a Card`,
        };
      }

      // Card-less assignment: no physical NFC card is bound yet, so the
      // product is an "uninstantiated" card product. Its configuration is
      // stored on the assignment (UserProduct.pendingConfig) until a card is
      // bound later; there is no public route until then.
      if (!cardUid) {
        const userProduct = await UserProduct.create({
          userId: user._id,
          catalogProductId: catalogItem._id,
          quantity,
          unitPriceMinor: catalogItem.priceMinor,
          notes,
          assignedBy,
          material,
          // Seed the product title on the assignment so the uninstantiated
          // product displays the purchased product name from day one.
          pendingConfig: {
            kind: catalogItem.kind,
            cardLabel: catalogItem.name,
          },
        });

        return { ok: true, status: 201, data: { userProduct, card: null, cardCreated: false } };
      }

      // Provision + bind the physical card directly from the admin-supplied
      // UID. No pre-registered inventory record is required; an existing
      // unassigned card record with the same (normalized) UID is claimed.
      const provisioned = await provisionCardForAssignment({
        uid: cardUid,
        userId: user._id.toString(),
        userName: user.name,
        productName: catalogItem.name,
        kind: derivedKind,
      });
      if (!provisioned.ok) {
        return { ok: false, status: provisioned.status, error: provisioned.error };
      }

      const assigned = provisioned.card;

      try {
        // Generate routeSlug if not set (permanent dynamic route identifier).
        if (!assigned.routeSlug) {
          assigned.routeSlug = generateQrId(8);
          await assigned.save();
        }

        await Profile.findOneAndUpdate(
          { userId: user._id },
          { $setOnInsert: { userId: user._id }, $set: { cardId: assigned._id } },
          { new: true, upsert: true }
        );

        const userProduct = await UserProduct.create({
          userId: user._id,
          catalogProductId: catalogItem._id,
          cardId: assigned._id,
          quantity,
          unitPriceMinor: catalogItem.priceMinor,
          notes,
          assignedBy,
          material,
        });

        // Best-effort human-readable URL allocation ("{business}/{product}[-N]").
        // Idempotent and backfillable — a URL allocation failure must never
        // fail the product assignment itself.
        try {
          await ensureCardPublicSlug(assigned._id, user._id.toString());
        } catch (error) {
          console.error('ensureCardPublicSlug failed:', error);
        }

        return { ok: true, status: 201, data: { userProduct, card: assigned, cardCreated: provisioned.created } };
      } catch (error) {
        // Roll back a card we provisioned fresh in this call; a card we only
        // claimed (idempotent path) is released back to the unbound pool.
        if (provisioned.created) {
          await Card.deleteOne({ _id: assigned._id }).catch(() => undefined);
        } else {
          await Card.updateOne(
            { _id: assigned._id, assignedUserId: user._id },
            {
              $set: {
                assignedUserId: null,
                userId: null,
                status: 'unassigned',
                isActive: false,
                kind: 'profile',
              },
            }
          ).catch(() => undefined);
        }
        throw error;
      }
    }
    case 'standee': {
      // Resolve the product's fixed slot configuration from the hard-coded
      // catalog. Multi-profile standees (ALL_IN_ONE_STANDEE_3/4) declare a
      // fixed set of profile types and slot counts. The customer may change a
      // slot's destination but never its profile type.
      const productId = catalogItem.slug.toUpperCase().replace(/-/g, '_');
      const def = isProductId(productId) ? getProductDef(productId) : null;
      const profileConfig = def ? getStandeeProfileConfig(productId) : null;
      const fixedProfiles: string[] = profileConfig?.fixedProfiles?.length
        ? profileConfig.fixedProfiles
        : (Array.isArray(platforms) && platforms.length
            ? platforms
            : STANDEE_PLATFORMS.map((p) => p.id));
      const maxProfiles = profileConfig?.maxProfiles ?? fixedProfiles.length;

      const validPlatforms = Array.from(new Set(fixedProfiles.filter((p) => getStandeePlatformById(p))));

      const standee = await Standee.create({
        userId: user._id,
        // The purchased product name becomes the standee's public/title label
        // (Standy.displayName) so the CRM and the panel picker agree on its
        // name from day one. `name` remains the schema fallback.
        displayName: catalogItem.name,
        routeSlug: generateQrId(8),
        productKey: isProductId(productId) ? productId : '',
        maxProfiles,
        fixedProfiles: validPlatforms,
        panelQr: { qrId: generateQrId(), qrColor: '#000000' },
        socialQrs: validPlatforms.map((platform) => ({
          qrId: generateQrId(),
          platform,
          qrColor: '#000000',
          label: getStandeePlatformById(platform)?.name ?? platform,
        })),
      });

      const previousStandy = user.hasStandy;
      user.hasStandy = true;
      try {
        await user.save();

        const userProduct = await UserProduct.create({
          userId: user._id,
          catalogProductId: catalogItem._id,
          standeeId: standee._id,
          quantity,
          unitPriceMinor: catalogItem.priceMinor,
          notes,
          assignedBy,
        });

        // Best-effort human-readable URL allocation
        // ("{business}/standee[-N]"). Idempotent and backfillable — a URL
        // allocation failure must never fail the product assignment itself.
        try {
          await ensureStandeePublicSlug(standee._id, user._id.toString());
        } catch (error) {
          console.error('ensureStandeePublicSlug failed:', error);
        }

        return { ok: true, status: 201, data: { userProduct, standee } };
      } catch (error) {
        // A standee with no linked UserProduct is an incorrectly claimed item —
        // remove it and restore the legacy hasStandy flag.
        user.hasStandy = previousStandy;
        await user.save().catch(() => undefined);
        await Standee.deleteOne({ _id: standee._id });
        throw error;
      }
    }
    default: {
      const userProduct = await UserProduct.create({
        userId: user._id,
        catalogProductId: catalogItem._id,
        quantity,
        unitPriceMinor: catalogItem.priceMinor,
        notes,
        assignedBy,
      });

      return { ok: true, status: 201, data: { userProduct } };
    }
  }
}
