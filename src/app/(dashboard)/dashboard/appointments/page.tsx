import { redirect } from 'next/navigation';
import { requirePageCapability } from '@/lib/auth/capability-guard';

export default async function AppointmentsPageWrapper() {
  await requirePageCapability('appointments', { redirectTo: '/dashboard' });
  redirect('/dashboard');
}