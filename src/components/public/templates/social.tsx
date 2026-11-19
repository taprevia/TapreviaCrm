'use client';

import Image from 'next/image';
import { FaChevronRight, FaClock, FaEnvelope, FaPhone, FaStar, FaUserPlus } from 'react-icons/fa6';
import { getBrandIcon } from '@/utils/getBrandIcon';
import { safeExternalUrl } from '@/lib/safe-url';
import { publicBusinessHours } from '@/lib/business-hours';
import { downloadVcfForCard } from '@/lib/vcf-download';
import type { IProduct, IVcard, ReviewCta } from '../types';
import { SafeHtml } from '@/lib/sanitizer';

/**
 * SocialTemplate — "Social" smart card (`social`).
 *
 * Modern glassmorphic profile layout: cover banner, circular overlapping
 * avatar, quick contact actions (call / email / save-to-contacts) and a list
 * of dynamic brand links whose glyphs are derived from each link's hostname.
 *
 * Data is sourced from the live `vcard` (like every registry template); the
 * visual layer follows the mobile-first design spec verbatim.
 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Saved-theme overrides. Scoped classes are added only when the customer has
 * a valid stored colour, so cards without theme settings keep the original
 * glassmorphic look. Values are pre-validated #RRGGBB CSS variables supplied
 * by the public page (or builder preview) -- no raw client CSS is injected.
 */
const STYLES = `
/* Applied only for a validated custom background. All values are pre-validated
   CSS variables -- no raw client CSS is injected. */
.soc-themed-bg.soc-themed-bg{background-color:var(--v-bg,#0f172a);color:var(--v-text,#0f172a)}
/* Primary labels follow --v-text; secondary metadata follows --v-muted. */
.soc-themed-bg .text-white,
.soc-themed-bg .text-slate-100,
.soc-themed-bg .text-slate-200,
.soc-themed-bg .text-slate-300,
.soc-themed-bg .text-emerald-400,
.soc-themed-bg .text-sky-400,
.soc-themed-bg .text-purple-400,
.soc-themed-bg .text-indigo-300{color:var(--v-text,#0f172a)}
.soc-themed-bg .text-slate-400,
.soc-themed-bg .text-slate-500{color:var(--v-muted,#4b5563)}
.soc-themed-bg .soc-avatar-fallback{color:var(--v-on-accent,#ffffff)}
/* Surfaces and separators. Attribute selectors avoid Tailwind slash escaping. */
.soc-themed-bg [class~="bg-slate-800/80"],
.soc-themed-bg [class~="bg-slate-800"],
.soc-themed-bg [class~="bg-slate-700/50"],
.soc-themed-bg [class~="bg-slate-700"],
.soc-themed-bg [class~="bg-white/10"],
.soc-themed-bg [class~="bg-white/20"]{background-color:var(--v-surface,#f8fafc)}
.soc-themed-bg [class~="border-slate-900"],
.soc-themed-bg [class~="border-slate-700/50"],
.soc-themed-bg [class~="border-slate-700/40"],
.soc-themed-bg [class~="border-white/5"]{border-color:var(--v-border,#e5e7eb)}
.soc-themed-bg [class~="hover:bg-slate-800"]:hover,
.soc-themed-bg [class~="hover:bg-white/20"]:hover{background-color:var(--v-surface,#f8fafc)}
.soc-themed-bg .group:hover [class~="group-hover:bg-slate-700"]{background-color:var(--v-surface,#f8fafc)}
.soc-themed-bg .group:hover [class~="group-hover:text-slate-300"]{color:var(--v-text,#0f172a)}
/* Accent rules come last so a themed accent still wins for its glyph. */
.soc-themed-accent .soc-banner{background-image:linear-gradient(90deg,var(--v-accent),color-mix(in srgb,var(--v-accent) 55%,#a855f7),#ec4899)}
.soc-themed-accent .soc-avatar-fallback{background-image:linear-gradient(135deg,var(--v-accent),color-mix(in srgb,var(--v-accent) 50%,#ec4899))}
.soc-themed-accent .text-indigo-300{color:var(--v-accent)}
/* Link cards (dynamic links + native AI CTA): unlayered rules beat the global
   :root * dark border token. Custom-background themes keep their own higher-
   specificity border mapping below. */
.soc-link-card{border-color:rgb(148 163 184 / .22);box-shadow:0 1px 2px rgb(2 6 23 / .16)}
.soc-link-card:hover{border-color:rgb(148 163 184 / .34)}
.soc-link-card:focus-visible{outline:2px solid var(--v-accent,#818cf8);outline-offset:2px;box-shadow:0 0 0 4px color-mix(in srgb,var(--v-accent,#818cf8) 22%,transparent)}
.soc-themed-bg .soc-link-card{border-color:var(--v-border,#e5e7eb)}
.soc-themed-bg .soc-link-card:hover{border-color:color-mix(in srgb,var(--v-accent,#6366f1) 40%,var(--v-border,#e5e7eb))}
`;

interface SocialLink {
  url: string;
  title: string;
}

function buildLinks(vcard: IVcard): SocialLink[] {
  return (vcard.socialLinks ?? [])
    .map((link) => ({
      url: safeExternalUrl(link.url),
      title: link.label?.trim() || link.platform?.trim() || 'Visit',
    }))
    .filter((link) => link.url.length > 0);
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

export function SocialTemplate({
  vcard,
  reviewCta,
}: {
  vcard: IVcard;
  products: IProduct[];
  reviewCta?: ReviewCta;
}) {
  const name =
    vcard.name?.trim() ||
    [vcard.basic?.firstName?.trim(), vcard.basic?.lastName?.trim()].filter(Boolean).join(' ').trim() ||
    'Profile';
  const title = (vcard.basic?.jobTitle?.trim() || vcard.occupation?.trim() || '') as string;
  const company = (vcard.basic?.company?.trim() || '') as string;
  const bio = (vcard.descriptionHtml?.trim() || '') as string;
  const email = (vcard.basic?.email?.trim() || '') as string;
  const phone = (vcard.basic?.phone?.trim() || '') as string;
  const avatarUrl = (vcard.profileImageUrl?.trim() || '') as string;

  // Cover banner: honour an image cover; otherwise render the gradient brand.
  const coverImage =
    vcard.coverType !== 'color' && vcard.coverValue?.trim() ? vcard.coverValue.trim() : '';

  const links = buildLinks(vcard);
  const hours = publicBusinessHours(vcard.businessHours, vcard.businessHoursFormat);
  // Native-signature pair means the customer explicitly reset to this
  // template's original theme: keep the dark, glassmorphic, gradient design.
  const accentHex = (vcard.themeConfig?.accentColor ?? '').trim().toUpperCase();
  const bgHex = (vcard.themeConfig?.bgColor ?? '').trim().toUpperCase();
  const isNativeTheme = accentHex === '#4F46E5' && bgHex === '#0F172A';
  const themedAccent = !isNativeTheme && HEX_COLOR_RE.test(vcard.themeConfig?.accentColor ?? '');
  const themedBg = !isNativeTheme && HEX_COLOR_RE.test(vcard.themeConfig?.bgColor ?? '');

  const downloadVCard = async () => {
    // The payload is built server-side by the canonical vCard 3.0 builder, so
    // this template can no longer emit a divergent (and unparseable) copy.
    const result = await downloadVcfForCard(vcard);
    if (result.status === 'error') console.error('[vcf] download failed:', result.message);
  };

  // The fixed dock is ~68px tall plus safe-area. Terminal sections already
  // reserve pb-8 (32px), so this adds only the remaining clearance and skips it
  // entirely when the dock is hidden. No shared dock/layout change is needed.
  const dockClearanceClass = vcard.config?.hideStickyBar
    ? ''
    : ' pb-[calc(36px_+_env(safe-area-inset-bottom))]';

  return (
    <div className={`max-w-md mx-auto min-h-screen bg-slate-900 text-white shadow-2xl relative overflow-hidden${dockClearanceClass} font-sans${themedAccent ? ' soc-themed-accent' : ''}${themedBg ? ' soc-themed-bg' : ''}`}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      {/* Banner */}
      <div className="h-36 sm:h-44 w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden soc-banner">
        {coverImage && (
          // Cover image, when set — SECURITY: coverValue is sanitized to
          // http(s) remote/S3 sources by the card save pipeline. Rendered
          // unoptimized so any sanitized remote host loads without needing a
          // next.config remotePatterns entry.
          <Image src={coverImage} alt="Cover" fill sizes="100vw" unoptimized className="object-cover" />
        )}
      </div>

      {/* Profile Header */}
      <div className="relative z-10 text-center">
        {avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={name}
            width={112}
            height={112}
            unoptimized
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-slate-900 -mt-12 mx-auto shadow-xl object-cover bg-slate-800"
          />
        ) : (
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-slate-900 -mt-12 mx-auto shadow-xl bg-gradient-to-br from-indigo-600 to-pink-600 flex items-center justify-center text-3xl font-bold text-white soc-avatar-fallback">
            {initialsFor(name)}
          </div>
        )}
        <h1 className="text-xl sm:text-2xl font-bold mt-3 text-white tracking-tight">{name}</h1>
        {(title || company) && (
          <p className="text-sm text-slate-400 font-medium mt-0.5">
            {title} {company && `at ${company}`}
          </p>
        )}
        {bio && (
          <div className="text-xs sm:text-sm text-slate-300 max-w-xs mx-auto mt-2 px-4 leading-relaxed">
            <SafeHtml html={bio} />
          </div>
        )}
      </div>

      {/* Quick Action Grid */}
      <div className="grid grid-cols-3 gap-3 my-6 px-6">
        {phone && (
          <a
            href={`tel:${phone}`}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/5 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
          >
            <FaPhone className="text-emerald-400 text-lg" aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-200 mt-1">Call</span>
          </a>
        )}
        {email && (
          <a
            href={`mailto:${email}`}
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/5 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
          >
            <FaEnvelope className="text-sky-400 text-lg" aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-200 mt-1">Email</span>
          </a>
        )}
        {vcard.config?.displayAddToContact !== false && <button
          type="button"
          onClick={downloadVCard}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/5 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
        >
          <FaUserPlus className="text-purple-400 text-lg" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-200 mt-1">Save</span>
        </button>}
      </div>

      {/* Dynamic Links */}
      {(links.length > 0 || reviewCta) && (
        <div className="flex flex-col gap-3 px-6 pb-8">
          {links.map((link, idx) => (
            <a
              key={`${link.url}-${idx}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.title}
              className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border soc-link-card transition-all duration-200 hover:-translate-y-0.5 group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-slate-700/50 group-hover:bg-slate-700 text-white shrink-0">
                {getBrandIcon(link.url)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate text-slate-100">{link.title}</div>
                <div className="text-xs text-slate-400 truncate">{link.url}</div>
              </div>
              <FaChevronRight
                className="text-slate-500 group-hover:text-slate-300 text-xs ml-auto shrink-0"
                aria-hidden="true"
              />
            </a>
          ))}
          {reviewCta && (
            <a
              href={reviewCta.href}
              aria-label={`Rate ${name} on Google`}
              className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border soc-link-card transition-all duration-200 hover:-translate-y-0.5 group cursor-pointer"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-slate-700/50 group-hover:bg-slate-700 text-white shrink-0">
                <FaStar aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate text-slate-100">Share your experience</div>
                <div className="text-xs text-slate-400 truncate">Rate us on Google</div>
              </div>
              <FaChevronRight
                className="text-slate-500 group-hover:text-slate-300 text-xs ml-auto shrink-0"
                aria-hidden="true"
              />
            </a>
          )}
        </div>
      )}

      {/* Business Hours */}
      {hours.length > 0 && (
        <div className="px-6 pb-8">
          <div className="flex items-center gap-2 mb-3">
            <FaClock className="text-indigo-300" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Business Hours</h2>
          </div>
          <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 overflow-hidden">
            {hours.map((h, idx) => (
              <div
                key={h.day}
                className={`flex items-center justify-between px-4 py-2.5 ${idx > 0 ? 'border-t border-slate-700/40' : ''}`}
              >
                <span className="text-sm font-medium text-slate-200">{h.label}</span>
                <span className={`text-sm tabular-nums ${h.closed ? 'italic text-slate-500' : 'text-slate-400'}`}>
                  {h.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Powered by Taprevia */}
      <footer className="mt-7 px-6 pb-8 pt-5 text-center">
        <span aria-hidden="true" className="mx-auto mb-2 block h-px w-12 bg-white/20" />
        <p className="text-[11px] tracking-wide text-slate-400">
          Powered by <span className="font-bold text-indigo-300">Taprevia</span>
        </p>
        <a
          href="https://taprevia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto mt-1.5 inline-flex max-w-full min-h-11 items-center justify-center px-2 text-center text-[11px] font-medium tracking-wide text-indigo-300 transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
        >
          Click here to create your digital business card
        </a>
      </footer>
    </div>
  );
}
