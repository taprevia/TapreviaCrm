import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import Profile from '@/models/Profile';
import { getPublicCardByPublicSlug, getPublicStandeeByPublicSlug } from '@/lib/services/human-url';
import { PublicCardPage, buildPublicCardMetadata, StandeeLanding } from '@/components/public';
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
    const card = await resolveCard(params.business, params.product);
    if (card) {
      return buildPublicCardMetadata(toPlain<ICard>(card));
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
  const card = await resolveCard(params.business, params.product);
  if (card) {
    return <PublicCardPage card={toPlain<ICard>(card)!} />;
  }
  const panel = await resolveStandee(params.business, params.product);
  if (panel && panel.slotCount >= 1) {
    return <StandeeLanding panel={panel} />;
  }
  notFound();
}