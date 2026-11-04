import type { Metadata } from 'next';
import { cache } from 'react';
import { connectDB } from '@/lib/db';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { vcardDisplayName } from '@/components/public/hero';
import {
  ReviewExperience,
  resolveReviewAccess,
  type ReviewAccess,
} from '@/components/review/review-experience';
import type { ICard } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: { alias: string } };

interface OwnerAccess extends ReviewAccess {
  card: ICard;
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

  const access = await resolveReviewAccess(card);
  if (!access) return null;
  return { card, ...access };
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

  return (
    <ReviewExperience
      card={access.card}
      config={access.config}
      languages={access.languages}
      alias={params.alias}
    />
  );
}