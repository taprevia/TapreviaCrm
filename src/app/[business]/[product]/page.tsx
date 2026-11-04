import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import Profile from '@/models/Profile';
import { getPublicCardByPublicSlug, getPublicStandeeByPublicSlug } from '@/lib/services/human-url';
import { PublicCardPage, buildPublicCardMetadata, StandeeLanding } from '@/components/public';
import { vcardDisplayName } from '@/components/public/hero';
import { ReviewExperience, resolveReviewAccess } from '@/components/review/review-experience';
import { resolveStandeePanel } from '@/lib/services/standee-panel';
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
  userId: unknown;
  routeSlug: string;
  displayName?: string;
  maxProfiles?: number;
  fixedProfiles?: string[];
  socialQrs?: Array<{
    platform?: string;
    destinationUrl?: string;
    label?: string;
  }>;
}

async function resolveStandee(business: string, product: string) {
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

  const panel = resolveStandeePanel(
    standee,
    profile?.companyName?.trim() || profile?.displayName?.trim() || null,
    (profile?.socialLinks ?? []).filter((l) => l.url?.trim()).map((l) => l.platform)
  );

  return panel;
}

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
    const panel = await resolveStandee(params.business, params.product);
    if (panel) {
      return {
        title: panel.ownerName ? `${panel.ownerName} · Taprevia` : 'Choose a destination',
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
  const panel = await resolveStandee(params.business, params.product);
  if (panel && panel.slotCount >= 1) {
    return <StandeeLanding panel={panel} />;
  }
  notFound();
}