import type { Metadata } from 'next';
import { cache } from 'react';
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

interface OwnerAccess {
  card: ICard;
  config: IReviewAssistantConfig;
  languages: string[];
}

/**
 * Single cached entry point for every read this page needs.
 *
 * Keyed on the PRIMITIVE `alias` string, never on a freshly-built object:
 * React `cache()` dedupes by argument identity, so passing a per-call DTO or
 * mapped object produced a cache miss on every call and re-ran the whole
 * entitlement sweep (~3 extra Atlas queries per render).
 *
 * `generateMetadata` and the page component share this resolver, so the card
 * lookup, the capability check and the language resolution each execute exactly
 * once per request.
 *
 * SECURITY: returns the RAW document. The entitlement gate needs `userId ??
 * assignedUserId` and the enabled flag needs `reviewAssistant`; both are
 * intentionally absent from `toPublicCardDto`, which belongs only at JSON API
 * boundaries.
 *
 * Eligibility rule (unchanged): the authoritative gate is the
 * `review_ai_suggestions` capability granted through
 * ProductDefinition/UserProduct — see `resolveEntitlement`. Page and review
 * APIs must agree so a customer can never load an assistant that later rejects
 * their request. Owner identity uses `userId ?? assignedUserId` to match how
 * cards are resolved elsewhere (a card bound to a physical holder may only
 * carry the holder id).
 */
const resolveOwnerAccess = cache(async (alias: string): Promise<OwnerAccess | null> => {
  await connectDB();
  const card = (await getPublicCardByAlias(alias)) as unknown as ICard | null;
  if (!card) return null;

  const config = card.reviewAssistant as IReviewAssistantConfig | undefined;
  if (!config?.enabled) return null;

  const ownerId = (card.userId ?? card.assignedUserId) ?? null;
  if (!ownerId) return null;

  // Parallel: the capability sweep and the language lookup are independent
  // round-trips, so serialising them doubled the page's DB wall-clock.
  const [allowed, languages] = await Promise.all([
    hasCapability(ownerId, 'review_ai_suggestions'),
    resolveReviewLanguages(config),
  ]);

  return allowed ? { card, config, languages } : null;
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const access = await resolveOwnerAccess(params.alias);
    if (!access) {
      return { title: 'Review not available', robots: { index: false, follow: false } };
    }
    return {
      title: `Leave a review for ${vcardDisplayName(access.card)}`,
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

export default async function ReviewPage({ params }: Params) {
  const access = await resolveOwnerAccess(params.alias);
  if (!access) return <Unavailable />;

  const { card, config, languages } = access;

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