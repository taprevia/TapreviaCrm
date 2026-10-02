import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';

export default async function FacebookDashboardPage() {
  const user = await requirePageCapability('facebook');
  await redirectPlatformDestination(user._id, 'facebook');
}