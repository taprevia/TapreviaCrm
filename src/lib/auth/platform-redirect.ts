/**
 * Platform destination redirect helper.
 *
 * The standalone per-platform dashboard pages (Instagram, Google Reviews,
 * WhatsApp, LinkedIn, Facebook) are no longer management areas in their own
 * right — those destinations are managed inside the customer's vCard and
 * Standee configuration. Old bookmarked routes stay alive but redirect to the
 * most appropriate management destination for the caller's entitlement.
 *
 * Order of preference:
 *   0. The specific CARD editor for this platform — when the customer owns
 *      EXACTLY ONE active card-backed assignment that grants the platform
 *      capability (canonical manage target; never guesses an instance).
 *   1. /dashboard/standees  — the user owns a standee (slot destinations).
 *   2. /dashboard/vcards    — the user owns a card (vCard social destinations).
 *   3. /dashboard/products  — universal My Products fallback (never 404).
 *
 * Step 0 uses only existing services/models (UserProduct, CatalogProduct and
 * the hard-coded catalog capabilities); it does not change authorization —
 * callers still gate the page with requirePageCapability before redirecting.
 */

import { redirect } from 'next/navigation';
import { getUserCapabilities } from '@/lib/auth/capability-guard';
import { connectDB } from '@/lib/db';
import UserProduct from '@/models/UserProduct';
import { getProductCapabilities, isProductId, type ProductId } from '@/config/products';

/** Platform capabilities that map to a customer-facing platform sidebar row. */
export type PlatformCapability =
  | 'linkedin'
  | 'instagram'
  | 'google_review'
  | 'facebook'
  | 'whatsapp';

/**
 * Resolve the specific card editor for a platform capability when EXACTLY one
 * active, card-backed assignment grants it. Returns null for zero or multiple
 * matches (ambiguous / standee-only) so the caller falls back to the
 * capability-based destination. Never guesses, never crosses products.
 */
async function resolvePlatformCardEditor(
  userId: string,
  platform: PlatformCapability
): Promise<string | null> {
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

  // Exactly one match = unambiguous ownership. Otherwise fall through.
  if (cardIds.size !== 1) return null;
  return `/dashboard/vcards/${[...cardIds][0]}/edit`;
}

export async function redirectPlatformDestination(
  userId: string,
  platform?: PlatformCapability
): Promise<never> {
  if (platform) {
    const cardEditor = await resolvePlatformCardEditor(userId, platform);
    if (cardEditor) redirect(cardEditor);
  }

  const caps = await getUserCapabilities(userId);

  if (caps.includes('standee')) {
    redirect('/dashboard/standees');
  }

  if (caps.includes('profile_edit')) {
    redirect('/dashboard/vcards');
  }

  redirect('/dashboard/products');
}
