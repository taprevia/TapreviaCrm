'use client';

import { FaChevronRight, FaEnvelope, FaPhone, FaUserPlus } from 'react-icons/fa6';
import { getBrandIcon } from '@/utils/getBrandIcon';
import { safeExternalUrl } from '@/lib/safe-url';
import { downloadVcfForCard } from '@/lib/vcf-download';
import type { IProduct, IVcard } from '../types';
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
}: {
  vcard: IVcard;
  products: IProduct[];
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

  const downloadVCard = async () => {
    // The payload is built server-side by the canonical vCard 3.0 builder, so
    // this template can no longer emit a divergent (and unparseable) copy.
    const result = await downloadVcfForCard(vcard);
    if (result.status === 'error') console.error('[vcf] download failed:', result.message);
  };

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-900 text-white shadow-2xl relative overflow-hidden font-sans">
      {/* Banner */}
      <div className="h-36 sm:h-44 w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden">
        {coverImage && (
          // Cover image, when set — SECURITY: coverValue is sanitized to
          // http(s) remote/S3 sources by the card save pipeline.
          <img src={coverImage} alt="Cover" className="w-full h-full object-cover" />
        )}
      </div>

      {/* Profile Header */}
      <div className="relative z-10 text-center">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-slate-900 -mt-12 mx-auto shadow-xl object-cover bg-slate-800"
          />
        ) : (
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-slate-900 -mt-12 mx-auto shadow-xl bg-gradient-to-br from-indigo-600 to-pink-600 flex items-center justify-center text-3xl font-bold text-white">
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
        <button
          type="button"
          onClick={downloadVCard}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/5 backdrop-blur-md transition-all active:scale-95 cursor-pointer"
        >
          <FaUserPlus className="text-purple-400 text-lg" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-200 mt-1">Save</span>
        </button>
      </div>

      {/* Dynamic Links */}
      {links.length > 0 && (
        <div className="flex flex-col gap-3 px-6 pb-8">
          {links.map((link, idx) => (
            <a
              key={`${link.url}-${idx}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={link.title}
              className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/50 shadow-md transition-all duration-200 hover:-translate-y-0.5 group cursor-pointer"
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
        </div>
      )}
    </div>
  );
}