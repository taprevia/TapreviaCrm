import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';

export default async function InstagramDashboardPage() {
  const user = await requirePageCapability('instagram');
  await redirectPlatformDestination(user._id, 'instagram');
}