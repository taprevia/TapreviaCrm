import { redirect } from 'next/navigation';
import { getAuthUserForPage } from '@/lib/auth/capability-guard';
import { AccountDetails } from './account-details';
import { ChangePasswordForm } from './change-password';

export default async function AccountSettingsPage() {
  const user = await getAuthUserForPage();
  if (!user) redirect('/login');

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Account Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your account security</p>
      </div>

      <AccountDetails
        name={user.name}
        email={user.email}
        customerId={user.customerId}
        bizSlug={user.bizSlug}
      />

      <ChangePasswordForm />
    </div>
  );
}