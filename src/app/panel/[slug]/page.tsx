import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import { StandeeLanding } from '@/components/public';
import { resolveStandeePanel } from '@/lib/services/standee-panel';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

interface StandeeDoc {
  routeSlug: string;
  userId: unknown;
  displayName?: string;
  maxProfiles?: number;
  fixedProfiles?: string[];
  socialQrs?: Array<{
    platform?: string;
    destinationUrl?: string;
    label?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Choose a destination',
    robots: { index: false, follow: false },
  };
}

export default async function PanelPage({ params }: Params) {
  await connectDB();
  const standee = (await Standee.findOne({
    $expr: { $eq: [{ $toLower: '$routeSlug' }, params.slug.toLowerCase()] },
  }).lean()) as StandeeDoc | null;
  if (!standee) notFound();

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

  if (panel.slotCount < 1) notFound();

  return <StandeeLanding panel={panel} />;
}