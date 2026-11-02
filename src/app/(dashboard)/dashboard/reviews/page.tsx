import { redirect } from 'next/navigation';
import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';
import { hasCapability } from '@/lib/services/capability-access';

/**
 * Legacy Google Reviews entry point.
 *
 * Review configuration now lives in the single Review Management module.
 * Customers whose products include review management are sent there; a
 * legacy account without that capability keeps the previous platform
 * destination instead of receiving a 403.
 */
export default async function ReviewsDashboardPage() {
  const user = await requirePageCapability('google_review');
  if (await hasCapability(user._id, 'review_ai_suggestions')) {
    redirect('/dashboard/review-management');
  }
  await redirectPlatformDestination(user._id, 'google_review');
}
