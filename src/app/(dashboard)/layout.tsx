import { getAuthUserForPage } from '@/lib/auth/capability-guard';
import { resolveEntitlement } from '@/lib/services/capability-access';
import { resolvePlatformRowDestinations } from '@/lib/auth/platform-nav';
import { redirect } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/sidebar';

export const dynamic = 'force-dynamic';

/**
 * Dashboard shell — a server component.
 *
 * Resolves the authenticated user + their entitlement ONCE, server-side, and
 * passes the resolved capabilities down to the client shell. Navigation is
 * filtered from the SERVER-resolved entitlement (no client fetch / flash),
 * and unauthenticated sessions are bounced here as a second net after
 * middleware.
 */
export default async function DashboardLayoutWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUserForPage();

  if (!user) {
    redirect('/login');
  }

  const entitlement = await resolveEntitlement(user._id);
  const capabilities = Array.from(entitlement.capabilities);

  // Where each platform sidebar row leads for this customer, so the client
  // shell can drop rows that would duplicate another management row (P7-3).
  const platformDestinations = await resolvePlatformRowDestinations(user._id, capabilities);

  return (
    <DashboardLayout
      user={{
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        customerId: user.customerId,
        bizSlug: user.bizSlug,
      }}
      capabilities={capabilities}
      platformDestinations={platformDestinations}
    >
      {children}
    </DashboardLayout>
  );
}