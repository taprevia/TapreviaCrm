import { redirect } from 'next/navigation';
import { requirePageCapability } from '@/lib/auth/capability-guard';

export default async function InquiriesPageWrapper() {
  await requirePageCapability('lead_capture', { redirectTo: '/dashboard' });
  redirect('/dashboard');
}