import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Product from '@/models/Product';
import TenantSettings from '@/models/TenantSettings';
import User from '@/models/User';
import { logPublicCardAction } from '@/lib/analytics';
import { PublicVcardRenderer } from '@/components/public/template-registry';
import { canUseFeature } from '@/lib/services/feature-access';
import { isSafeExternalUrl } from '@/lib/safe-url';
import type { ICard, IProduct } from '@/types';

/**
 * Social cards never render a profile: record the redirect server-side, then
 * 307 to the configured destination. Invalid/inactive destinations 404.
 */
async function dispatchSocialCard(card: ICard): Promise<never> {
  const dest = card.redirectUrl?.trim() ?? '';
  if (!isSafeExternalUrl(dest)) notFound();

  // Best-effort analytics: a telemetry failure must never block the visitor's
  // external redirect (fail-open, like all public flows).
  try {
    await logPublicCardAction(
      card._id,
      'social_redirect',
      `alias:${card.urlAlias}`,
      headers()
    );
  } catch (error) {
    console.error('social_redirect analytics failed:', error);
  }

  redirect(dest);
}

/**
 * Review cards never render a profile: forward to the existing review
 * experience only when it is actually published/enabled; otherwise fail
 * safely with a non-informative 404 (same convention as social cards
 * with an invalid destination).
 */
async function dispatchReviewCard(card: ICard, alias: string): Promise<never> {
  const enabled = card.reviewAssistant?.enabled === true;
  if (!enabled) notFound();
  redirect(`/review/${alias}`);
}

function luminance(hex: string): number {
  const m = hex.replace('#', '');
  if (m.length !== 6) return 1;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Single public rendering system for a resolved card. Both /profile/[alias]
 * and /{business}/{product} delegate here so the human-readable URL renders
 * the exact same experience as the legacy profile route (kind dispatch,
 * feature gate, catalog + settings, themed vcard).
 */
export async function PublicCardPage({ card }: { card: ICard }) {
  if (card.kind === 'social') {
    await dispatchSocialCard(card);
  }

  if (card.kind === 'review') {
    await dispatchReviewCard(card, (card.urlAlias || card.slug || '').toLowerCase());
  }

  // Resolve the owning account ONCE, before any tenant-scoped query.
  //
  // SECURITY: a card must always resolve to an owner. If it does not, every
  // downstream lookup degrades into an unscoped read — `Product.find({})` and
  // `TenantSettings.findOne({})` both match an arbitrary document when their
  // filter key is undefined, which would leak another tenant's products and
  // settings onto this page. Fail closed instead.
  const ownerId = (card.userId ?? card.assignedUserId) ?? null;
  if (!ownerId) notFound();

  // Product feature gate: profile pages are a Profile vCard feature. Fails
  // closed for cards whose owner's products don't include it.
  const profileAllowed = await canUseFeature(ownerId, 'profile');
  if (!profileAllowed) notFound();

  // Both queries are owner/card scoped. `cardId` and `userId` are guaranteed
  // defined by the guard above, so neither filter can collapse to `{}`.
  if (!card._id) notFound();

  const products = (await Product.find({
    cardId: card._id,
    active: true,
  })
    .sort({ sortOrder: 1, createdAt: -1 })
    .select('title description priceMinor currency imageUrl category active')
    .lean()) as unknown as IProduct[];

  const settings = (await TenantSettings.findOne({ userId: ownerId }).lean()) as {
    general?: { newsletterModalDelaySeconds?: number };
  } | null;

  // The newsletter popup is opt-in per customer (default OFF). Resolve the
  // card owner's preference server-side so the client component only arms
  // its delay timer when the owner enabled it.
  const owner = (await User.findById(ownerId).select('isNewsletterEnabled').lean()) as {
    isNewsletterEnabled?: boolean;
  } | null;
  const newsletterEnabled = owner?.isNewsletterEnabled === true;

  const accent = /^#[0-9a-fA-F]{6}$/.test(card.themeConfig?.accentColor ?? '')
    ? card.themeConfig.accentColor
    : '#2563EB';
  const bg = /^#[0-9a-fA-F]{6}$/.test(card.themeConfig?.bgColor ?? '')
    ? card.themeConfig.bgColor
    : '#FFFFFF';
  const isDarkBg = luminance(bg) < 0.18;

  const themeVars = {
    '--v-bg': bg,
    '--v-accent': accent,
    '--v-on-accent': luminance(accent) > 0.45 ? '#0B0F19' : '#FFFFFF',
    ...(isDarkBg
      ? {
          '--v-surface': '#1E293B',
          '--v-text': '#F8FAFC',
          '--v-muted': '#94A3B8',
          '--v-border': '#334155',
        }
      : {}),
  } as React.CSSProperties;

  return (
    <div className="vcard-root min-h-screen" style={themeVars}>
      <PublicVcardRenderer
        vcard={card}
        products={products}
        newsletterDelaySeconds={settings?.general?.newsletterModalDelaySeconds ?? 8}
        newsletterEnabled={newsletterEnabled}
      />
    </div>
  );
}

/**
 * Shared page metadata for card experiences, used by /profile/[alias] and the
 * human-readable /{business}/{product} route.
 */
export function buildPublicCardMetadata(card: ICard | null): Metadata {
  if (!card) return { title: 'Card not found' };
  if (card.kind === 'social') {
    return { title: 'Redirecting…', robots: { index: false, follow: false } };
  }

  const displayName =
    [card.basic?.firstName, card.basic?.lastName].filter(Boolean).join(' ') ||
    card.name;

  if (card.kind === 'review') {
    return {
      title: `Leave a review for ${displayName}`,
      robots: { index: false, follow: false },
    };
  }

  const description =
    card.basic?.jobTitle || card.occupation
      ? `${displayName} — ${card.basic?.jobTitle || card.occupation}${card.basic?.company ? ` at ${card.basic.company}` : ''
      }. Connect, save contact & reach out.`
      : `Digital business card of ${displayName}.`;

  const image = card.profileImageUrl || (card.coverType === 'image' ? card.coverValue : '');

  return {
    title: displayName,
    description,
    openGraph: {
      title: displayName,
      description,
      type: 'profile',
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: displayName,
      description,
      images: image ? [image] : undefined,
    },
  };
}