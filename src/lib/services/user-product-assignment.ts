import Card from '@/models/Card';
import Profile from '@/models/Profile';
import Standee from '@/models/Standee';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import { deriveCardKind } from '@/lib/services/product-experience';
import { provisionCardForAssignment, allocateCardRouteSlug, allocateDigitalCardUid } from '@/lib/services/card-identity';
import { ensureCardPublicSlug, ensureStandeePublicSlug } from '@/lib/services/human-url';
import { STANDEE_PLATFORMS, getStandeePlatformById } from '@/lib/constants';
import { generateQrId } from '@/lib/utils';
import { generateUniqueTimestampUid } from '@/lib/uid';
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

/**
 * Allocate a permanent standee route identifier for a NEW assignment.
 *
 * Mirrors `allocateCardRouteSlug`: timestamp UID checked against BOTH the
 * `routeSlug` and the new `uid` field so it can never collide with a legacy
 * routeSlug or a previously issued timestamp UID.
 */
async function allocateStandeeRouteSlug(): Promise<string> {
  return generateUniqueTimestampUid(async (candidate) =>
    Boolean(
      await Standee.exists({ $or: [{ routeSlug: candidate }, { uid: candidate }] })
    )
  );
}

export type AssignUserProductResult =
  | { ok: true; status: 201; data: AssignedProductData }
  | { ok: false; status: number; error: string };

interface AssignUserProductArgs {
  user: UserDoc;
  catalogItem: CatalogProductDoc;
  quantity: number;
  /**
   * Admin-supplied physical NFC card UID. When omitted the assignment is
   * DIGITAL-FIRST: a synthetic `DIGITAL-…` UID is minted so a real Card is
   * still provisioned and bound (see the `case 'card'` branch below).
   */
  cardUid?: string;
  platforms?: string[];
  notes?: string;
  assignedBy: string;
  material?: 'pvc' | 'metal' | 'wooden';
}

/**
 * Fulfil a catalog purchase for a user. Creates side-effect records per category:
 * cards are atomically claimed and linked to the profile (physical UID, or a
 * synthetic digital-first UID when no hardware is supplied yet), standees generate panel +
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

      // DIGITAL-FIRST ASSIGNMENT (no physical NFC card yet):
      //
      // A Card document is the only routable/previewable card — the vCards
      // dashboard reads the Card collection, and `unboundCardNeedsSetup` drives
      // "Setup Required" off `instance === null`. Leaving the assignment as a
      // bare `pendingConfig` row (cardId null) therefore produced a product the
      // customer could never configure into existence, preview, or find on the
      // portal. A card product sold WITHOUT a hardware UID now still gets a
      // real Card record: a synthetic `DIGITAL-…` UID is minted and the card is
      // provisioned/bound exactly like a physical one (timestamp route UID,
      // active + owned, human public URL, purchased name as its label).
      //
      // The initial config the old `pendingConfig` path carried (kind +
      // cardLabel) lands on the Card itself via `provisionCardForAssignment`,
      // so the assignment is a single source of truth from day one. When the
      // physical card is bound later the admin replaces ONLY `cardUid` in place
      // (see replaceCardForAssignment) — the permanent routeSlug/uid and public
      // URL are preserved, so nothing already shared or printed breaks.
      const bindingUid = cardUid ?? (await allocateDigitalCardUid());

      // Provision + bind the card. A physical UID claims/binds directly (no
      // pre-registered inventory required); the synthetic digital UID does the
      // same for hardware-less sales.
      const provisioned = await provisionCardForAssignment({
        uid: bindingUid,
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
          assigned.routeSlug = await allocateCardRouteSlug();
          if (!assigned.uid) assigned.uid = assigned.routeSlug;
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

      const routeSlug = await allocateStandeeRouteSlug();

      const standee = await Standee.create({
        userId: user._id,
        // The purchased product name becomes the standee's public/title label
        // (Standy.displayName) so the CRM and the panel picker agree on its
        // name from day one. `name` remains the schema fallback.
        displayName: catalogItem.name,
        routeSlug,
        // Mirror the timestamp UID onto the dedicated `uid` field so resolvers
        // can dual-track legacy `routeSlug` and new timestamp identifiers.
        uid: routeSlug,
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
