/**
 * Standee multi-action landing page. Rendered at the internal /panel/[slug]
 * route and at the public "}/{business-slug}/standee[-N]" URL so scanned
 * visitors pick a platform destination from all configured standee slots.
 */

import Link from 'next/link';
import { ChevronRight, Star, QrCode } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandIcon } from '@/components/public/socials-row';
import type { ResolvedStandeePanel, StandeePanelIconKey } from '@/lib/services/standee-panel';

function PlatformGlyph({ iconKey }: { iconKey: StandeePanelIconKey }) {
  if (iconKey !== 'google_review' && iconKey !== 'qr') {
    return (
      <span className="pointer-events-none inline-flex text-[#063B50] transition-colors duration-200 group-hover:text-[#008D8A]">
        <BrandIcon platform={iconKey} size={30} />
      </span>
    );
  }
  const Icon: LucideIcon = iconKey === 'google_review' ? Star : QrCode;
  return (
    <Icon
      className="pointer-events-none h-[clamp(1.625rem,7.5vw,1.875rem)] w-[clamp(1.625rem,7.5vw,1.875rem)]"
      strokeWidth={1.9}
    />
  );
}

function platformDescription(platform: string, configured: boolean) {
  if (!configured) return 'Not configured';

  switch (platform) {
    case 'google_review':
      return 'Share your review & support';
    case 'instagram':
      return 'Follow for updates & highlights';
    case 'whatsapp':
      return 'Chat with us instantly';
    case 'facebook':
      return 'Stay connected on Facebook';
    default:
      return 'Open';
  }
}

function TopWaves() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[104px] overflow-hidden sm:h-[128px]"
    >
      <svg
        viewBox="0 0 390 120"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none h-full w-full"
      >
        <defs>
          <linearGradient id="standee-top-navy" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#042B3E" />
            <stop offset="100%" stopColor="#063B50" />
          </linearGradient>
          <linearGradient id="standee-top-teal" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#008D8A" />
            <stop offset="100%" stopColor="#0BA7A1" />
          </linearGradient>
        </defs>
        <path
          fill="url(#standee-top-navy)"
          d="M0 0H390V7C329 9 279 21 229 44C167 72 99 88 0 100V0Z"
        />
        <path
          fill="url(#standee-top-teal)"
          d="M0 106C53 106 101 91 151 66C208 37 267 24 353 17C322 33 282 44 239 58C181 78 128 105 75 120C44 128 19 131 0 129V106Z"
        />
        <path
          d="M0 104C54 104 102 89 152 64C208 35 268 22 353 15"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function BottomWaves() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[118px] overflow-hidden sm:h-[146px]"
    >
      <svg
        viewBox="0 0 390 140"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none h-full w-full"
      >
        <defs>
          <linearGradient id="standee-bottom-teal" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0BA7A1" />
            <stop offset="100%" stopColor="#008D8A" />
          </linearGradient>
          <linearGradient id="standee-bottom-navy" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#063B50" />
            <stop offset="100%" stopColor="#042B3E" />
          </linearGradient>
        </defs>
        <path
          fill="url(#standee-bottom-teal)"
          d="M390 72C346 73 307 86 268 106C220 130 166 140 104 140H0V140H390V72Z"
        />
        <path
          fill="url(#standee-bottom-navy)"
          d="M390 90C352 92 317 104 282 121C234 143 178 151 108 150H0V150H390V90Z"
        />
        <path
          d="M390 90C352 92 317 104 282 121C234 143 178 151 108 150"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export default function StandeeLanding({ panel }: { panel: ResolvedStandeePanel }) {
  const { ownerName, slotCount, slots } = panel;

  return (
    <main className="relative isolate min-h-screen min-h-[100svh] overflow-hidden bg-white px-4 pb-[calc(8.25rem+env(safe-area-inset-bottom))] pt-[110px] text-[#071C2B] sm:px-6 sm:pb-[10rem] sm:pt-[138px]">
      <TopWaves />

      <div className="relative z-10 mx-auto w-full max-w-[600px]">
        <header className="mb-7 text-center sm:mb-9">
          <div aria-hidden="true" className="pointer-events-none mb-5 flex items-center justify-center gap-3 sm:mb-6 sm:gap-4">
            <span className="h-px w-14 bg-[#063B50]/70 sm:w-20" />
            <svg
              viewBox="0 0 38 28"
              aria-hidden="true"
              focusable="false"
              className="pointer-events-none h-7 w-9 shrink-0"
            >
              <path d="M7 2h13l-5 24H2L7 2Z" fill="#008D8A" />
              <path d="M24 2h13l-5 24H19L24 2Z" fill="#0BA7A1" />
            </svg>
            <span className="h-px w-14 bg-[#063B50]/70 sm:w-20" />
          </div>

          <h1 className="text-balance break-words text-[clamp(1.75rem,8.6vw,2.375rem)] font-extrabold uppercase leading-[1.08] tracking-[-0.025em] text-[#063B50] [overflow-wrap:anywhere]">
            {ownerName || 'Connect with us'}
          </h1>

          <p className="mt-3.5 flex items-center justify-center gap-2.5 text-[clamp(0.6875rem,3.3vw,0.875rem)] font-semibold uppercase tracking-[0.26em] text-[#33383D] sm:mt-4 sm:gap-3.5">
            <span aria-hidden="true" className="pointer-events-none h-px w-7 shrink-0 bg-[#063B50]/60 sm:w-10" />
            <span className="whitespace-nowrap">Connect with us</span>
            <span aria-hidden="true" className="pointer-events-none h-px w-7 shrink-0 bg-[#063B50]/60 sm:w-10" />
          </p>

          <p className="text-balance mx-auto mt-3 max-w-[320px] text-[clamp(0.875rem,3.9vw,1rem)] leading-[1.5] text-[#33383D] sm:mt-4">
            Choose an option to get in touch or share your feedback.
          </p>
        </header>

        <div className="space-y-3.5 sm:space-y-4">
          {slots.map((slot) =>
            slot.configured ? (
              <Link
                key={slot.href}
                href={slot.href}
                className="group relative flex min-h-[82px] w-full items-center gap-2.5 rounded-[20px] border !border-[#E5E9EC] bg-white px-3 py-3 shadow-[0_6px_22px_rgba(4,43,62,0.09)] transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(4,43,62,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008D8A] focus-visible:ring-offset-2 active:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[94px] sm:gap-4 sm:rounded-[24px] sm:px-4 sm:py-4"
              >
                <span className="flex h-[clamp(3rem,14vw,3.75rem)] w-[clamp(3rem,14vw,3.75rem)] shrink-0 items-center justify-center rounded-[clamp(0.875rem,4vw,1.125rem)] bg-[#E6F3F2] text-[#063B50] ring-1 ring-inset ring-[#D9ECEA] transition-colors duration-200 group-hover:bg-[#DDF0EE]">
                  <PlatformGlyph iconKey={slot.iconKey} />
                </span>

                <span aria-hidden="true" className="pointer-events-none h-[42px] w-px shrink-0 bg-[#D0D6DA] sm:h-[48px]" />

                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[clamp(1.125rem,4.8vw,1.375rem)] font-bold leading-[1.2] text-[#071C2B]">
                    {slot.label}
                  </span>
                  <span className="mt-1 block text-[clamp(0.75rem,3.2vw,0.875rem)] leading-[1.4] text-[#33383D]">
                    {platformDescription(slot.platform, slot.configured)}
                  </span>
                </span>

                <span
                  aria-hidden="true"
                  className="pointer-events-none ml-1 flex h-[clamp(2.25rem,9.5vw,2.625rem)] w-[clamp(2.25rem,9.5vw,2.625rem)] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0BA7A1] to-[#008D8A] text-white shadow-[0_4px_10px_rgba(0,141,138,0.28)]"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
                </span>
              </Link>
            ) : (
              <div
                key={slot.href}
                className="flex min-h-[82px] w-full items-center gap-2.5 rounded-[20px] border !border-[#E5E9EC] bg-white px-3 py-3 opacity-70 shadow-[0_4px_16px_rgba(4,43,62,0.06)] sm:min-h-[94px] sm:gap-4 sm:rounded-[24px] sm:px-4 sm:py-4"
                title="This destination is not configured yet"
              >
                <span className="flex h-[clamp(3rem,14vw,3.75rem)] w-[clamp(3rem,14vw,3.75rem)] shrink-0 items-center justify-center rounded-[clamp(0.875rem,4vw,1.125rem)] bg-[#E6F3F2] text-[#6E7D85] ring-1 ring-inset ring-[#D9ECEA]">
                  <PlatformGlyph iconKey={slot.iconKey} />
                </span>

                <span aria-hidden="true" className="pointer-events-none h-[42px] w-px shrink-0 bg-[#D0D6DA] sm:h-[48px]" />

                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[clamp(1.125rem,4.8vw,1.375rem)] font-bold leading-[1.2] text-[#5B6A72]">
                    {slot.label}
                  </span>
                  <span className="mt-1 block text-[clamp(0.75rem,3.2vw,0.875rem)] leading-[1.4] text-[#7A878E]">
                    {platformDescription(slot.platform, slot.configured)}
                  </span>
                </span>
              </div>
            )
          )}
        </div>

        <p className="mt-7 text-center text-[11px] font-medium tracking-[0.08em] text-[#5B6A72] sm:mt-9 sm:text-xs">
          Taprevia · {slotCount}-profile standee
        </p>
      </div>

      <BottomWaves />
    </main>
  );
}
