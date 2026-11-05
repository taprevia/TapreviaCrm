import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import Standee from '@/models/Standee';
import Profile from '@/models/Profile';
import { StandeeLanding } from '@/components/public';
import { resolveStandeePanel } from '@/lib/services/standee-panel';
import { isStandeeOwnerPubliclyVisible } from '@/lib/services/public-owner-visibility';
import { recordPublicVisit } from '@/lib/services/public-visits';

export const dynamic = 'force-dynamic';

type Params = { params: { slug: string } };

interface StandeeDoc {
  _id: unknown;
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
    $or: [
      { $expr: { $eq: [{ $toLower: '$routeSlug' }, params.slug.toLowerCase()] } },
      { uid: params.slug.toLowerCase() },
    ],
  }).lean()) as StandeeDoc | null;
  if (!standee || !(await isStandeeOwnerPubliclyVisible(standee.userId))) notFound();

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

  await recordPublicVisit({ standeeId: standee._id, headers: headers() });
  return <StandeeLanding panel={panel} />;
}