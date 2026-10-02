import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { connectDB } from '@/lib/db';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { hasCapability } from '@/lib/services/capability-access';
import { getInitials, vcardDisplayName } from '@/components/public/hero';
import { ReviewAssistantFlow } from '@/components/review/review-assistant';
import { getReviewLanguageOptions } from '@/lib/services/review-templates';
import type { ICard, IReviewAssistantConfig } from '@/types';


export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

function luminance(hex: string): number {
  const m = hex.replace('#', '');
  if (m.length !== 6) return 1;
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const loadCard = cache(async (alias: string) => {
  await connectDB();
  return getPublicCardByAlias(alias) as unknown as Promise<ICard | null>;
});

/**
 * Eligibility for the public Review Assistant.
 *
 * The authoritative gate for this flow is the `review_ai_suggestions`
 * capability (granted through ProductDefinition/UserProduct — see
 * `resolveEntitlement`). Page and review APIs must agree so a customer can
 * never load an assistant that later rejects their request. The owner
 * identity uses `userId ?? assignedUserId` to match how cards are resolved
 * elsewhere (a bound card may only carry the physical-holder id).
 */
const canUseReview = cache(async (card: ICard | null): Promise<boolean> => {
  if (!card) return false;
  const ownerId = (card.userId ?? card.assignedUserId) ?? null;
  if (!ownerId) return false;
  return hasCapability(ownerId, 'review_ai_suggestions');
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const card = await loadCard(params.alias);
    if (!card || !card.reviewAssistant?.enabled || !(await canUseReview(card))) {
      return { title: 'Review not available', robots: { index: false, follow: false } };
    }
    return {
      title: `Leave a review for ${vcardDisplayName(card)}`,
      robots: { index: false, follow: false },
    };
  } catch {
    return { title: 'Leave a review' };
  }
}

/** Public "unavailable" state — used for disabled Review Assistant. */
function Unavailable() {
  return (
    <div className="vcard-root flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-[var(--v-text)]">Reviews aren’t available right now.</p>
      </div>
    </div>
  );
}

/**
 * Language options for the customer-side language selector, strictly derived
 * from the languages actually present on the selected category's active
 * templates (`getReviewLanguageOptions`). If the category has no templates to
 * back them, fall back to the business's configured languages, and only then
 * to 'English' — so the selector is never empty or stuck.
 */
async function resolveReviewLanguages(config: IReviewAssistantConfig): Promise<string[]> {
  if (config.category) {
    const available = await getReviewLanguageOptions(config.category);
    if (available.length > 0) return available;
  }
  const configured = (config.languages ?? [])
    .map((lang) => lang.trim())
    .filter((lang) => lang.length > 0);
  if (configured.length > 0) return configured;
  return ['English'];
}

export default async function ReviewPage({ params }: Params) {
  const card = await loadCard(params.alias);
  if (!card) notFound();

  const config = card.reviewAssistant as IReviewAssistantConfig | undefined;
  if (!config?.enabled || !(await canUseReview(card))) {
    return <Unavailable />;
  }

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
    // Accent buttons pick dark text on light accents and light text on dark
    // accents — the same rule PublicCardPage uses.
    '--v-on-accent': luminance(accent) > 0.45 ? '#0B0F19' : '#FFFFFF',
    // A dark business background must not produce dark-on-dark text — match
    // PublicCardPage's dark surface/text/border/border variables.
    ...(isDarkBg
      ? {
          '--v-surface': '#1E293B',
          '--v-text': '#F8FAFC',
          '--v-muted': '#94A3B8',
          '--v-border': '#334155',
        }
      : {}),
  } as React.CSSProperties;

  const name = vcardDisplayName(card);
  const avatarUrl = card.profileImageUrl?.trim();
  const languages = await resolveReviewLanguages(config);

  return (
    <div className="vcard-root min-h-screen" style={themeVars}>
      <ReviewAssistantFlow
        alias={params.alias.toLowerCase()}
        businessName={name}
        avatarUrl={avatarUrl}
        initials={getInitials(card)}
        config={{
          googleReviewUrl: config.googleReviewUrl ?? '',
          welcomeMessage: config.welcomeMessage ?? '',
          writingStyle: config.writingStyle,
          preferredLength: config.preferredLength,
          languages,
          feedbackTopics: config.feedbackTopics ?? [],
        }}
      />
    </div>
  );
}