import { requirePageCapability } from '@/lib/auth/capability-guard';
import StandeeManager from '@/components/dashboard/standee-manager';

export default async function StandeesDashboardPage() {
  await requirePageCapability('standee');

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">My Standees</h1>
        <p className="text-ink-mute text-sm mt-0.5">
          Configure each fixed slot&apos;s destination — change anytime, no reprint needed.
        </p>
      </div>
      <StandeeManager />
    </div>
  );
}
