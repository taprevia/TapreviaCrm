import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';

export default async function LinkedInDashboardPage() {
  const user = await requirePageCapability('linkedin');
  await redirectPlatformDestination(user._id, 'linkedin');
}