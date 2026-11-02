import { requirePageCapability } from '@/lib/auth/capability-guard';
import { ReviewManagementClient } from '@/components/review-management/review-management-client';

export const dynamic = 'force-dynamic';

/**
 * Review Management — centralized business review preferences.
 *
 * Server-side entitlement guard mirrors the API and navigation capability.
 * The page never creates a ReviewSettings document; it is read-only until the
 * customer explicitly saves.
 */
export default async function ReviewManagementPage({
  searchParams,
}: {
  searchParams?: { cardId?: string | string[] };
}) {
  await requirePageCapability('review_ai_suggestions');
  const cardId =
    typeof searchParams?.cardId === 'string' ? searchParams.cardId : undefined;
  return <ReviewManagementClient initialCardId={cardId} />;
}
