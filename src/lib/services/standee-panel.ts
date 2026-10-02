/**
 * Shared resolution of a standee's panel slots. Used by both the internal
 * landing page (/panel/[slug]) and the public standee URL
 * ("/{business-slug}/standee[-N]") so the two never drift.
 */

export type StandeePanelIconKey =
  | 'google_review'
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'qr';

export interface StandeePanelSlot {
  /** 1-based physical slot position on the standee. */
  index: number;
  platform: string;
  label: string;
  iconKey: StandeePanelIconKey;
  configured: boolean;
  /** Permanent per-slot route ("/r/{routeSlug}/{index}") — resolves to the destination. */
  href: string;
}

export interface StandeePanelSource {
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

export interface ResolvedStandeePanel {
  ownerName: string | null;
  slotCount: number;
  slots: StandeePanelSlot[];
}

const PLATFORM_META: Record<string, { label: string; iconKey: StandeePanelIconKey }> = {
  google_review: { label: 'Google Review', iconKey: 'google_review' },
  instagram: { label: 'Instagram', iconKey: 'instagram' },
  facebook: { label: 'Facebook', iconKey: 'facebook' },
  whatsapp: { label: 'WhatsApp', iconKey: 'whatsapp' },
};

export function resolveStandeePanel(
  standee: StandeePanelSource,
  profileOwnerName: string | null,
  socialPlatforms: string[]
): ResolvedStandeePanel {
  const socialQrs = standee.socialQrs ?? [];
  const fixedProfiles = standee.fixedProfiles ?? [];

  // Canonical 3/4 profile order: fixedProfiles when the product defines them
  // (google_review, instagram, facebook · + whatsapp), falling back to the
  // per-slot platform order stored on the standee document.
  const profileOrder =
    fixedProfiles.length > 0
      ? fixedProfiles
      : socialQrs.map((qr) => qr.platform).filter(Boolean);

  const slotCount = Math.max(
    profileOrder.length,
    socialQrs.length,
    standee.maxProfiles ?? 0
  );

  const slots: StandeePanelSlot[] = Array.from({ length: slotCount }, (_, i) => {
    const platform = profileOrder[i] ?? socialQrs[i]?.platform ?? `slot_${i + 1}`;
    const qr = socialQrs[i];
    const meta = PLATFORM_META[platform] ?? {
      label:
        qr?.label?.trim() ||
        qr?.platform?.replace(/_/g, ' ') ||
        `Destination ${i + 1}`,
      iconKey: 'qr' as const,
    };
    const configured = Boolean(
      qr?.destinationUrl?.trim() || socialPlatforms.includes(platform)
    );
    return {
      index: i + 1,
      platform,
      label: meta.label,
      iconKey: meta.iconKey,
      configured,
      href: `/r/${standee.routeSlug}/${i + 1}`,
    };
  });

  const ownerName = standee.displayName?.trim() || profileOwnerName || null;

  return { ownerName, slotCount, slots };
}