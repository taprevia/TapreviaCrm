import { requirePageCapability } from '@/lib/auth/capability-guard';
import PageClient from './page-client';

export default async function SubscribersPageWrapper() {
  await requirePageCapability('lead_capture', { redirectTo: '/dashboard' });
  return <PageClient />;
}