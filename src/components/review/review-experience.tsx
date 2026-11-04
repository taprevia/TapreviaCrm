import type { ICard } from '@/types';
import type { ResolvedReviewSettings } from '@/lib/services/review-settings-resolver';
import { getCardReviewEntitlement } from '@/lib/services/review-entitlement';
import { resolveEffectiveReviewSettings } from '@/lib/services/review-effective-settings';
import { getReviewLanguageOptions } from '@/lib/services/review-templates';
import { ReviewAssistantFlow } from '@/components/review/review-assistant';
import { getInitials, vcardDisplayName } from '@/components/public/hero';
import { COPY_FLOW_ACTIVE, REVIEW_ROTATION_ACTIVE } from '@/lib/review-feature-flags';
import type { IReviewAssistantConfig } from '@/types';

export interface ReviewAccess {
  config: ResolvedReviewSettings;
  languages: string[];
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
 * Language options for the customer-side language selector, strictly derived
 * from the languages actually present on the selected category's active
 * templates. Fall back to the business's configured languages, then English.
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

/**
 * Shared entitlement + effective-settings gate for every review surface.
 * The Card must belong to an owner and be entitled to `review_ai_suggestions`;
 * unpublished/disabled review settings return null.
 */
export async function resolveReviewAccess(card: ICard): Promise<ReviewAccess | null> {
  const ownerId = (card.userId ?? card.assignedUserId) ?? null;
  if (!ownerId) return null;

  const [entitled, effective] = await Promise.all([
    getCardReviewEntitlement(card),
    resolveEffectiveReviewSettings(card),
  ]);
  if (!entitled.entitled || !effective.enabled) return null;

  const languages = await resolveReviewLanguages(effective);
  return { config: effective, languages };
}

/**
 * Renders the review experience without owning a route. Used by both
 * `/review/[alias]` (legacy/canonical review page) and `/{business}/{product}`
 * (branded publicSlug) so the two paths cannot drift.
 */
export function ReviewExperience({
  card,
  config,
  languages,
  alias,
}: {
  card: ICard;
  config: ResolvedReviewSettings;
  languages: string[];
  alias: string;
}) {
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

  const name = vcardDisplayName(card);
  const avatarUrl = card.profileImageUrl?.trim();

  return (
    <div className="vcard-root min-h-screen" style={themeVars}>
      <ReviewAssistantFlow
        alias={alias.toLowerCase()}
        businessName={name}
        avatarUrl={avatarUrl}
        initials={getInitials(card)}
        copyFlowEnabled={COPY_FLOW_ACTIVE}
        rotationEnabled={REVIEW_ROTATION_ACTIVE}
        config={{
          googleReviewUrl: config.googleReviewUrl ?? '',
          welcomeMessage: config.welcomeMessage ?? '',
          writingStyle: config.writingStyle,
          preferredLength: config.preferredLength,
          languages,
          feedbackTopics: config.feedbackTopics ?? [],
          styleMode: config.styleMode,
          lengthMode: config.lengthMode,
        }}
      />
    </div>
  );
}
