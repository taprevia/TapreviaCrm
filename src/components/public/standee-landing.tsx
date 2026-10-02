/**
 * Standee multi-action landing page. Rendered at the internal /panel/[slug]
 * route and at the public "}/{business-slug}/standee[-N]" URL so scanned
 * visitors pick a platform destination from all configured standee slots.
 */

import Link from 'next/link';
import { Star, Plus, QrCode } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandIcon } from '@/components/public/socials-row';
import type { ResolvedStandeePanel, StandeePanelIconKey } from '@/lib/services/standee-panel';

function PlatformGlyph({ iconKey }: { iconKey: StandeePanelIconKey }) {
  if (iconKey !== 'google_review' && iconKey !== 'qr') {
    return (
      <span className="text-blue-400 transition group-hover:text-white">
        <BrandIcon platform={iconKey} size={20} />
      </span>
    );
  }
  const Icon: LucideIcon = iconKey === 'google_review' ? Star : QrCode;
  return <Icon className="h-5 w-5" />;
}

export default function StandeeLanding({ panel }: { panel: ResolvedStandeePanel }) {
  const { ownerName, slotCount, slots } = panel;

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-900/30 mb-4">
            <QrCode className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            {ownerName || 'Connect with us'}
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Choose a platform to continue
          </p>
        </div>

        <div className="space-y-3">
          {slots.map((slot) =>
            slot.configured ? (
              <Link
                key={slot.href}
                href={slot.href}
                className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 transition hover:border-blue-500/50 hover:bg-slate-800/80 hover:shadow-lg hover:shadow-blue-900/20"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800 transition group-hover:bg-blue-500">
                  <PlatformGlyph iconKey={slot.iconKey} />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-medium text-white">
                    {slot.label}
                  </span>
                  <span className="block text-xs text-slate-500">Open</span>
                </span>
                <Plus className="h-5 w-5 -rotate-45 text-slate-600 transition group-hover:text-blue-400" />
              </Link>
            ) : (
              <div
                key={slot.href}
                className="flex items-center gap-4 rounded-2xl border border-slate-800/60 bg-slate-900/40 px-5 py-4 opacity-60"
                title="This destination is not configured yet"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-800/70 text-slate-500">
                  <PlatformGlyph iconKey={slot.iconKey} />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-medium text-slate-400">
                    {slot.label}
                  </span>
                  <span className="block text-xs text-slate-500">
                    Not configured
                  </span>
                </span>
              </div>
            )
          )}
        </div>

        <p className="mt-8 text-center text-xs text-slate-600">
          Taprevia · {slotCount}-profile standee
        </p>
      </div>
    </main>
  );
}