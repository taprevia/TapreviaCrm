import { redirect } from 'next/navigation';
import { ALL_CAPABILITIES } from '@/config/capabilities';
import { getAuthUserForPage } from '@/lib/auth/capability-guard';
import { resolveEntitlement } from '@/lib/services/capability-access';
import { DashboardLayout } from '@/components/layout/sidebar';

export const dynamic = 'force-dynamic';

/**
 * Admin shell — a server component (parallel to the dashboard shell).
 *
 * Operators get the full capability set so the customer-style shell shows
 * every navigation row, preserving admin tooling behind the same layout.
 */
export default async function AdminLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUserForPage();

  if (!user) {
    redirect('/login');
  }

  const entitlement = await resolveEntitlement(user._id);
  const capabilities =
    user.role === 'admin'
      ? Array.from(ALL_CAPABILITIES)
      : Array.from(entitlement.capabilities);

  return (
    <DashboardLayout
      user={{ id: user._id, name: user.name, email: user.email, role: user.role }}
      capabilities={capabilities}
    >
      {children}
    </DashboardLayout>
  );
}