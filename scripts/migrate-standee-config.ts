/**
 * Backfill multi-profile standee configuration on existing Standee documents.
 *
 * Multi-profile standees (ALL_IN_ONE_STANDEE_3 / ALL_IN_ONE_STANDEE_4) gained
 * fixed profile-type slots. Existing standees created before this migration
 * have `socialQrs` but no `fixedProfiles`/`maxProfiles`/`productKey`.
 *
 * This migration:
 *  - Finds each standee linked to a UserProduct (its entitlement).
 *  - Resolves the productId from the catalog product slug.
 *  - Writes back productKey, maxProfiles and fixedProfiles from the product
 *    definition, and re-orders socialQrs to match the fixed profile order.
 *
 * Idempotent — safe to run multiple times. Does not delete any data.
 *
 * Run with: npx tsx scripts/migrate-standee-config.ts
 */

import { connectDB } from '@/lib/db';
import Standee from '@/models/Standee';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';
import {
  isProductId,
  getProductDef,
  getStandeeProfileConfig,
} from '@/config/products';

async function main(): Promise<void> {
  await connectDB();

  const standees = await Standee.find({}).lean();

  let updated = 0;
  let skipped = 0;

  for (const standee of standees) {
    // Skip standees already correctly configured.
    if (
      standee.fixedProfiles?.length &&
      standee.maxProfiles &&
      standee.fixedProfiles.length === standee.maxProfiles
    ) {
      skipped += 1;
      continue;
    }

    // Resolve productId via the standee's entitlement (UserProduct).
    const assignment = (await UserProduct.findOne({ standeeId: standee._id })
      .select('catalogProductId')
      .lean()) as unknown as { catalogProductId?: unknown } | null;

    let productId: string | null = null;
    if (assignment?.catalogProductId) {
      const catalog = (await CatalogProduct.findById(assignment.catalogProductId)
        .select('slug')
        .lean()) as unknown as { slug?: string } | null;
      productId = catalog?.slug?.toUpperCase().replace(/-/g, '_') ?? null;
    }

    if (!productId || !isProductId(productId)) {
      console.log(`standee ${standee._id}: no mapped product, skipping`);
      skipped += 1;
      continue;
    }

    const definition = getProductDef(productId);
    const profileConfig = getStandeeProfileConfig(productId);

    if (!profileConfig) {
      // Not a multi-profile standee product. Just tag the product key.
      await Standee.updateOne(
        { _id: standee._id },
        { $set: { productKey: definition.id } }
      );
      skipped += 1;
      continue;
    }

    const fixedProfiles = profileConfig.fixedProfiles;
    const maxProfiles = profileConfig.maxProfiles;

    // Re-order existing socialQrs to match fixed profile order. Preserve any
    // slot that already exists; fill missing slot types with new QRs so the
    // physical standee has a QR per slot.
    const existingByPlatform = new Map<string, { qrId: string; qrColor: string; label: string; destinationUrl: string }>();
    for (const qr of standee.socialQrs ?? []) {
      if (qr.platform && !existingByPlatform.has(qr.platform)) {
        existingByPlatform.set(qr.platform, {
          qrId: qr.qrId,
          qrColor: qr.qrColor ?? '#000000',
          label: qr.label ?? '',
          destinationUrl: qr.destinationUrl ?? '',
        });
      }
    }

    const { generateQrId } = await import('@/lib/utils');
    const orderedSocialQrs = fixedProfiles.map((platform: string) => {
      const existing = existingByPlatform.get(platform);
      if (existing) return existing;
      return {
        qrId: generateQrId(),
        platform,
        qrColor: '#000000' as string,
        label: '' as string,
        destinationUrl: '' as string,
      };
    });

    const fixed = await import('@/lib/constants');
    const labelled = orderedSocialQrs.map((qr) => ({
      ...qr,
      label: qr.label || fixed.getStandeePlatformById((qr as { platform?: string }).platform ?? '')?.name || qr.label,
    }));

    await Standee.updateOne(
      { _id: standee._id },
      {
        $set: {
          productKey: definition.id,
          maxProfiles,
          fixedProfiles,
          socialQrs: labelled,
        },
      }
    );

    updated += 1;
    console.log(
      `standee ${standee._id}: ${definition.id} -> ${maxProfiles} profiles [${fixedProfiles.join(', ')}]`
    );
  }

  console.log(`migration complete: updated=${updated} skipped=${skipped}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
