import type { Metadata } from 'next';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Profile from '@/models/Profile';
import { getPublicCardByPublicSlug, getPublicStandeeByPublicSlug } from '@/lib/services/human-url';
import { withPublicCardVisibility } from '@/lib/services/card-access';
import { PublicCardPage, buildPublicCardMetadata, StandeeLanding } from '@/components/public';
import { vcardDisplayName } from '@/components/public/hero';
import { ReviewExperience, resolveReviewAccess } from '@/components/review/review-experience';
import { resolveStandeePanel } from '@/lib/services/standee-panel';
import { resolveStandeeEntryDecision } from '@/lib/services/standee-entry-state';
import { wouldRedirectLoop } from '@/lib/services/redirect-loop';
import { canonicalPublicBase } from '@/lib/public-base';
import { recordPublicVisit } from '@/lib/services/public-visits';
import type { ICard } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: { business: string; product: string } };

function toPlain<T>(raw: unknown): T | null {
  if (!raw) return null;
  return ((raw as { toObject?: () => T }).toObject?.() ??
    (raw as unknown as T)) as T;
}

async function resolveCard(business: string, product: string) {
  await connectDB();
  // Static route prefixes (/admin, /api, /dashboard, /profile, …) always win
  // over this dynamic root route; anything else is treated as a card lookup.
  return getPublicCardByPublicSlug(`${business}/${product}`);
}

interface ReviewPageResolution {
  card: ICard;
  review: boolean;
  access: Awaited<ReturnType<typeof resolveReviewAccess>>;
  alias: string | null;
}

/**
 * Named publicSlug resolution for both metadata and rendering. For a review
 * Card this resolves entitlement/publication too, so a published review can be
 * served directly at the branded URL (no redirect to /review/{alias}).
 * Unpublished review Cards return `access: null`; callers fail closed.
 */
const resolveReviewPage = cache(async (business: string, product: string): Promise<ReviewPageResolution | null> => {
  const raw = await resolveCard(business, product);
  if (!raw) return null;
  const card = toPlain<ICard>(raw)!;
  if (card.kind !== 'review') return { card, review: false, access: null, alias: null };

  const alias = (card.urlAlias || card.slug || '').trim().toLowerCase();
  if (!alias) return { card, review: true, access: null, alias: null };
  const access = await resolveReviewAccess(card);
  return { card, review: true, access, alias };
});

interface StandeePublicDoc {
  _id: unknown;
  userId: unknown;
  routeSlug: string;
  uid?: string;
  displayName?: string;
  publicSlug?: string;
  productKey?: string;
  maxProfiles?: number;
  fixedProfiles?: string[];
  socialQrs?: Array<{
    platform?: string;
    destinationUrl?: string;
    label?: string;
  }>;
}

const resolveStandee = cache(async (business: string, product: string) => {
  await connectDB();
  const standee = (await getPublicStandeeByPublicSlug(
    `${business}/${product}`
  )) as unknown as StandeePublicDoc | null;
  if (!standee) return null;

  const profile = (await Profile.findOne({ userId: standee.userId })
    .select('socialLinks companyName displayName')
    .lean()) as {
    socialLinks?: Array<{ platform: string; url: string }>;
    companyName?: string;
    displayName?: string;
  } | null;

  const socialLinks = profile?.socialLinks ?? [];
  const panel = resolveStandeePanel(
    standee,
    profile?.companyName?.trim() || profile?.displayName?.trim() || null,
    socialLinks.filter((l) => l.url?.trim()).map((l) => l.platform)
  );

  return { standee, panel, socialLinks };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const resolved = await resolveReviewPage(params.business, params.product);
    if (resolved?.review) {
      if (!resolved.access) {
        return { title: 'Review not available', robots: { index: false, follow: false } };
      }
      return {
        title: `Leave a review for ${vcardDisplayName(resolved.card)}`,
        robots: { index: false, follow: false },
      };
    }
    if (resolved?.card) {
      return buildPublicCardMetadata(resolved.card);
    }
    const resolvedStandee = await resolveStandee(params.business, params.product);
    if (resolvedStandee) {
      return {
        title: resolvedStandee.panel.ownerName
          ? `${resolvedStandee.panel.ownerName} · Taprevia`
          : 'Choose a destination',
        robots: { index: false, follow: true },
      };
    }
    return { title: 'Digital Business Card' };
  } catch {
    return { title: 'Digital Business Card' };
  }
}

export default async function PublicHumanUrlPage({ params }: Params) {
  const resolved = await resolveReviewPage(params.business, params.product);
  if (resolved?.review) {
    // Published review Cards render directly at the branded publicSlug. This
    // intentionally does NOT redirect to /review/{alias}; unpublished Cards
    // fail closed with the same 404 behavior as before.
    if (!resolved.access || !resolved.alias) notFound();
    await recordPublicVisit({ cardId: resolved.card._id, headers: headers() });
    return (
      <ReviewExperience
        card={resolved.card}
        config={resolved.access.config}
        languages={resolved.access.languages}
        alias={resolved.alias}
      />
    );
  }
  if (resolved?.card) {
    // SECURITY: pass a faithful snapshot. PublicCardPage needs _id, userId /
    // assignedUserId, reviewAssistant and redirectUrl server-side — mapping
    // through toPublicCardDto() strips them and breaks the entitlement gate.
    // That mapper belongs only at JSON API boundaries.
    return (
      <PublicCardPage
        card={resolved.card}
        currentPath={`/${encodeURIComponent(params.business)}/${encodeURIComponent(params.product)}`}
      />
    );
  }
  const resolvedStandee = await resolveStandee(params.business, params.product);
  if (!resolvedStandee) notFound();

  const { standee, panel, socialLinks } = resolvedStandee;
  if (panel.slotCount < 1) notFound();

  let delegatePath: string | null = null;
  const origin = canonicalPublicBase();

  if (origin) {
    try {
      const routeKey = (standee.routeSlug || standee.uid || '').trim();
      if (routeKey) {
        const routeLookup = routeKey.toLowerCase();
        // Match /r's Card-first lookup exactly: a Card sharing this routeSlug
        // or uid would win there and must not be reached through a Standee URL.
        const cardCollision = await Card.findOne(
          withPublicCardVisibility({
            $or: [{ routeSlug: routeLookup }, { uid: routeLookup }],
          })
        )
          .select('_id')
          .lean();

        if (!cardCollision) {
          const decision = resolveStandeeEntryDecision({
            routeSlug: standee.routeSlug,
            uid: standee.uid,
            maxProfiles: standee.maxProfiles,
            fixedProfiles: standee.fixedProfiles,
            socialQrs: standee.socialQrs,
            socialLinks,
            origin,
          });

          if (decision.action === 'delegate') {
            const currentPath = `/${encodeURIComponent(params.business)}/${encodeURIComponent(
              params.product
            )}`;
            const loopDetected = await wouldRedirectLoop(
              currentPath,
              decision.path,
              origin
            );
            if (!loopDetected) delegatePath = decision.path;
          }
        }
      }
    } catch {
      // Fail closed: any preflight uncertainty keeps the existing picker.
      console.error('Standee branded-entry preflight failed');
    }
  }

  if (delegatePath) redirect(delegatePath);

  // Branded picker is the final destination for this navigation.
  await recordPublicVisit({ standeeId: standee._id, headers: headers() });
  return <StandeeLanding panel={panel} />;
}