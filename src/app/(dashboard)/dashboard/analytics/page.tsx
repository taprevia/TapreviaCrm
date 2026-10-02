import { requireAnyPageCapability } from '@/lib/auth/capability-guard';
import { ANALYTICS_CAPABILITIES } from '@/config/capabilities';
import PageClient from './page-client';

export default async function AnalyticsPageWrapper() {
  await requireAnyPageCapability([...ANALYTICS_CAPABILITIES], { redirectTo: '/dashboard' });
  return <PageClient />;
}