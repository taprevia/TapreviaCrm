import { requirePageCapability } from '@/lib/auth/capability-guard';
import { redirectPlatformDestination } from '@/lib/auth/platform-redirect';

export default async function WhatsAppDashboardPage() {
  const user = await requirePageCapability('whatsapp');
  await redirectPlatformDestination(user._id, 'whatsapp');
}