import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';

export default async function ReviewsDashboardPage() {
  const user = await requirePageCapability('google_review');
  await redirectPlatformDestination(user._id, 'google_review');
}