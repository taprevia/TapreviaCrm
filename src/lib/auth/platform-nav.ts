/**
 * Server-side resolution of where each customer-facing platform sidebar row
 * should land, so the client shell can drop rows that would only duplicate
 * another visible management row (e.g. every platform row of a standee-only
 * customer resolving back to the Standees manager).
 *
 * Uses the SAME destination preference as the standalone platform redirect
 * (src/lib/auth/platform-redirect.ts), mirrored by hand:
 *   0. the specific CARD editor — the caller owns EXACTLY ONE active
 *      card-backed assignment granting this platform capability;
 *   1. /dashboard/standees — the caller owns a standee (slot destinations);
 *   2. /dashboard/vcards   — the caller owns a card (vCard social destinations);
 *   3. /dashboard/products — universal My Products fallback (never dropped).
 *
 * platform-redirect.ts is deliberately left untouched; this helper only
 * re-derives the "exactly one card" target so navigation can be de-duplicated
 * without changing redirect semantics or authorization. The preference-0 scan
 * mirrors resolvePlatformCardEditor's query (one DB round-trip regardless of
 * capability count).
 */

import { connectDB } from '@/lib/db';
import UserProduct from '@/models/UserProduct';
import { getProductCapabilities, isProductId, type ProductId } from '@/config/products';
import type { CapabilityId } from '@/config/capabilities';
import type { PlatformCapability } from './platform-redirect';

/** Platform capability → the customer-facing sidebar row it unlocks. */
const PLATFORM_ROW_HREFS: Record<PlatformCapability, string> = {
  linkedin: '/dashboard/linkedin',
  instagram: '/dashboard/instagram',
  google_review: '/dashboard/reviews',
  facebook: '/dashboard/facebook',
  whatsapp: '/dashboard/whatsapp',
};

/**
 * Resolve the destination each platform row raised by `capabilities` should
 * lead to. Returns a plain href → target map; empty when the caller has no
 * platform capabilities (nothing to de-duplicate).
 */
export async function resolvePlatformRowDestinations(
  userId: string,
  capabilities: CapabilityId[] | ReadonlySet<CapabilityId>
): Promise<Record<string, string>> {
  const capSet: ReadonlySet<CapabilityId> =
    capabilities instanceof Set ? capabilities : new Set<CapabilityId>(capabilities);
  const platforms = (Object.keys(PLATFORM_ROW_HREFS) as PlatformCapability[]).filter((platform) =>
    capSet.has(platform)
  );
  if (platforms.length === 0) return {};

  await connectDB();
  const assignments = (await UserProduct.find({
    userId,
    status: 'active',
    cardId: { $ne: null },
  })
    .select('cardId catalogProductId')
    .populate('catalogProductId', 'slug')
    .lean()) as unknown as Array<{
    cardId: unknown;
    catalogProductId: { slug?: string } | null;
  }>;

  // The UNIQUE card-backed assignment that grants each platform capability
  // (never guesses when zero or multiple cards qualify).
  const uniqueCardEditor = new Map<PlatformCapability, string>();
  for (const platform of platforms) {
    const cardIds = new Set<string>();
    for (const assignment of assignments) {
      const slug = assignment.catalogProductId?.slug;
      if (!assignment.cardId || !slug) continue;
      const productId = slug.toUpperCase().replace(/-/g, '_') as ProductId;
      if (!isProductId(productId)) continue;
      if (getProductCapabilities(productId).includes(platform)) {
        cardIds.add(String(assignment.cardId));
      }
    }
    if (cardIds.size === 1) {
      uniqueCardEditor.set(platform, [...cardIds][0]);
    }
  }

  const destinations: Record<string, string> = {};
  for (const platform of platforms) {
    const editorCardId = uniqueCardEditor.get(platform);
    let target: string;
    if (editorCardId) {
      target = `/dashboard/vcards/${editorCardId}/edit`;
    } else if (capSet.has('standee')) {
      target = '/dashboard/standees';
    } else if (capSet.has('profile_edit')) {
      target = '/dashboard/vcards';
    } else {
      target = '/dashboard/products';
    }
    destinations[PLATFORM_ROW_HREFS[platform]] = target;
  }
  return destinations;
}