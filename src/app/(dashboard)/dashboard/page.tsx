import { redirect } from 'next/navigation';
import { ALL_CAPABILITIES } from '@/config/capabilities';
import { getAuthUserForPage } from '@/lib/auth/capability-guard';
import { resolveEntitlement } from '@/lib/services/capability-access';
import PageClient from './page-client';

/**
 * Dashboard overview — server wrapper.
 *
 * Resolves the entitlement ONCE server-side (mirroring the dashboard shell) so
 * the overview only shows the sections the customer's products entitle. Admins
 * previewing the customer dashboard get the full capability set (operator
 * bypass, consistent with the capability-guard policy).
 */
export default async function DashboardPage() {
  const user = await getAuthUserForPage();

  if (!user) {
    redirect('/login');
  }

  const entitlement = await resolveEntitlement(user._id);
  const capabilities =
    user.role === 'admin'
      ? Array.from(ALL_CAPABILITIES)
      : Array.from(entitlement.capabilities);

  return <PageClient capabilities={capabilities} />;
}