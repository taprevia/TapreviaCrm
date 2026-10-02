import { requirePageCapability } from '@/lib/auth/capability-guard';
import PageClient from './page-client';

export default async function VcardsPageWrapper() {
  await requirePageCapability('profile_edit', { redirectTo: '/dashboard' });
  return <PageClient />;
}