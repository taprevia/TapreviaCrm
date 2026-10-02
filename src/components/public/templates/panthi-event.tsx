'use client';

/**
 * PanthiEventTemplate — faithful port of the reference "Panthi Event"
 * card (`profile-card-v2.tsx` / Pep2PanthiEventProfile) into the Taprevia CRM.
 *
 * Expectation is copy-to-copy fidelity: the same scoped `.pep2-*` stylesheet,
 * icon set, product carousel, services list, gallery lightbox, WhatsApp lead
 * form, exchange sheet and sticky action bar. The only difference from the
 * standalone reference is that every string/image/link is sourced from the
 * live `vcard` / `products` / `services` data so the customer can edit them
 * via the builder (nothing is hardcoded).
 *
 * The `.pep2-*` palette is bridged to the CRM theme variables (`--v-accent`,
 * `--v-bg`, `--v-surface`, `--v-text`, `--v-muted`, `--v-border`) so the
 * builder preview and the live public page reflect the chosen brand theme.
 *
 * This is intentionally a client component — it drives the product carousel,
 * lightbox, sheet and form state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { safeExternalUrl } from '@/lib/safe-url';
import { downloadVcfForCard } from '@/lib/vcf-download';
import { brandLabelFromUrl } from '@/utils/get-link-icon';
import { getBrandIcon } from '@/utils/getBrandIcon';
import type { IVcard } from '../types';
import type { IProduct } from '../types';

/* ─────────────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────────────── */

interface PantheventProduct {
  title: string;
  desc: string | null;
  imageUrl: string;
}

interface PantheventSocial {
  network: string;
  url: string;
}

interface PantheventData {
  name: string;
  tagline: string;
  phoneDisplay: string;
  phoneRaw: string;
  email: string;
  website: string;
  cardUrl: string;
  bio: string | null;
  avatarUrl: string;
  heroUrl: string;
  socials: PantheventSocial[];
  products: PantheventProduct[];
  services: string[];
  gallery: string[];
}

type Pep2IconName =
  | 'share'
  | 'user-plus'
  | 'exchange'
  | 'close'
  | 'phone'
  | 'chat'
  | 'check'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'globe'
  | 'mail'
  | 'package'
  | 'wrench'
  | 'images'
  | 'clipboard'
  | 'heart'
  | 'briefcase'
  | 'sparkles'
  | 'megaphone'
  | 'cake'
  | 'gem'
  | 'star'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'twitter'
  | 'youtube'
  | 'pinterest';

/* ─────────────────────────────────────────────────────────────────────
 * Icon set (verbatim from the reference)
 * ───────────────────────────────────────────────────────────────────── */

const ICON_PATHS: Record<Pep2IconName, React.ReactNode> = {
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  'user-plus': (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </>
  ),
  exchange: (
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  chat: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  'chevron-left': <polyline points="15 18 9 12 15 6" />,
  'chevron-right': <polyline points="9 18 15 12 9 6" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
  package: (
    <>
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  images: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M12 11h4" />
      <path d="M12 16h4" />
      <path d="M8 11h.01" />
      <path d="M8 16h.01" />
    </>
  ),
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  ),
  briefcase: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </>
  ),
  megaphone: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
  cake: (
    <>
      <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
      <path d="M4 16c.9.9 1.8.9 2.7 0 .9-.9 1.8-.9 2.7 0 .9.9 1.8.9 2.7 0 .9-.9 1.8-.9 2.7 0 .9.9 1.8.9 2.7 0" />
      <path d="M12 9V5" />
      <path d="M8 9V7" />
      <path d="M16 9V7" />
      <path d="M2 21h20" />
    </>
  ),
  gem: (
    <>
      <path d="M6 3h12l4 6-10 13L2 9Z" />
      <path d="M11 3 8 9l4 13 4-13-3-6" />
      <path d="M2 9h20" />
    </>
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </>
  ),
  facebook: (
    <path
      fill="currentColor"
      stroke="none"
      d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
    />
  ),
  linkedin: (
    <path
      fill="currentColor"
      stroke="none"
      d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
    />
  ),
  twitter: (
    <path
      fill="currentColor"
      stroke="none"
      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
    />
  ),
  youtube: (
    <path
      fill="currentColor"
      stroke="none"
      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
    />
  ),
  pinterest: (
    <path
      fill="currentColor"
      stroke="none"
      d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z"
    />
  ),
};

interface IconProps {
  name: Pep2IconName;
  size?: number;
}

const Icon = ({ name, size = 18 }: IconProps): React.ReactElement => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {ICON_PATHS[name]}
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────
 * Constant maps + stylesheet (verbatim from the reference)
 * ───────────────────────────────────────────────────────────────────── */

const SERVICE_ICONS: Record<string, Pep2IconName> = {
  'Event Planning': 'clipboard',
  'Wedding Event': 'heart',
  'Corporate Event': 'briefcase',
  'Pre-Post Event': 'sparkles',
  'Brand activities': 'megaphone',
  'Birthday Party': 'cake',
  Anniversary: 'gem',
};

const VISIBLE_SERVICES = 3;

/** Exact title first, then keyword match, else the generic sparkles icon. */
function serviceIconFor(service: string): Pep2IconName {
  const exact = SERVICE_ICONS[service];
  if (exact) return exact;
  const label = service.toLowerCase();
  const match: Array<{ keywords: string[]; icon: Pep2IconName }> = [
    { keywords: ['wed'], icon: 'heart' },
    { keywords: ['corporate', 'conference', 'office', 'company'], icon: 'briefcase' },
    { keywords: ['birthday', 'party', 'kids', 'children'], icon: 'cake' },
    { keywords: ['anniversary', 'milestone'], icon: 'gem' },
    { keywords: ['brand', 'marketing', 'promo', 'launch'], icon: 'megaphone' },
    { keywords: ['plan', 'organiz', 'organis', 'manage'], icon: 'clipboard' },
    { keywords: ['pre', 'post', 'setup', 'support'], icon: 'sparkles' },
  ];
  const hit = match.find((entry) => entry.keywords.some((k) => label.includes(k)));
  return hit?.icon ?? 'sparkles';
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

.pep2-scope{--pep2-primary:var(--v-accent,#10b981);--pep2-primary-hover:color-mix(in srgb,var(--pep2-primary) 85%,#000);--pep2-primary-active:color-mix(in srgb,var(--pep2-primary) 72%,#000);--pep2-gradient:linear-gradient(135deg,var(--pep2-primary),color-mix(in srgb,var(--pep2-primary) 60%,#0ea5e9));--pep2-wa:#25D366;--pep2-wa-hover:#1fc35b;--pep2-bg:var(--v-bg,hsl(220 20% 97%));--pep2-surface:var(--v-surface,#ffffff);--pep2-muted:color-mix(in srgb,var(--v-surface,#ffffff) 96%,var(--v-text,#0f172a));--pep2-muted-hover:color-mix(in srgb,var(--v-surface,#ffffff) 92%,var(--v-text,#0f172a));--pep2-muted-fg:var(--v-muted,hsl(220 9% 46%));--pep2-fg:var(--v-text,hsl(222 47% 11%));--pep2-border:var(--v-border,hsl(220 13% 91%));--pep2-error:#ef4444;--pep2-wash-15:color-mix(in srgb,var(--pep2-primary) 15%,transparent);--pep2-wash-20:color-mix(in srgb,var(--pep2-primary) 20%,transparent);--pep2-halo:color-mix(in srgb,var(--pep2-primary) 25%,transparent);--pep2-shadow-card:0 1px 3px rgb(0 0 0/.04),0 1px 2px -1px rgb(0 0 0/.04);--pep2-shadow-up:0 10px 25px -5px rgb(0 0 0/.08),0 8px 10px -6px rgb(0 0 0/.04);--pep2-shadow-chip:0 2px 8px rgb(0 0 0/.12);--pep2-r-sm:8px;--pep2-r-md:12px;--pep2-r-lg:16px;--pep2-e-std:cubic-bezier(.4,0,.2,1);--pep2-e-decel:cubic-bezier(.05,.7,.1,1);--pep2-e-spring:cubic-bezier(.32,.72,0,1);display:block;min-height:100vh;background:var(--pep2-surface);font-family:'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--pep2-fg);-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;}
.pep2-scope *,.pep2-scope *::before,.pep2-scope *::after{box-sizing:border-box;margin:0;padding:0;}
.pep2-scope :focus-visible{outline:2px solid var(--pep2-primary);outline-offset:2px;border-radius:4px;}
.pep2-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}

.pep2-card{width:100%;max-width:448px;margin-inline:auto;background:var(--pep2-surface);}

.pep2-hero{position:relative;height:200px;overflow:hidden;background:var(--pep2-muted);}
.pep2-hero-img{width:100%;height:100%;object-fit:cover;display:block;}
.pep2-hero-dim{position:absolute;inset:0;background:rgb(15 23 42/.10);pointer-events:none;}
.pep2-hero-fade{position:absolute;inset:0;background:linear-gradient(180deg,rgb(255 255 255/0) 45%,var(--pep2-surface) 100%);pointer-events:none;}
.pep2-share-btn{position:absolute;top:12px;right:12px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.8);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:var(--pep2-shadow-chip);color:var(--pep2-fg);cursor:pointer;z-index:2;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-share-btn::after{content:"";position:absolute;inset:-4px;}
.pep2-share-btn:hover{background:rgb(255 255 255/.95);}
.pep2-share-btn:active{transform:scale(.95);}
.pep2-share-chip{position:absolute;top:15px;right:56px;max-width:70%;display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:9999px;background:rgb(15 23 42/.85);color:#fff;font-size:12px;line-height:1;font-weight:500;opacity:0;transform:translateY(-4px);pointer-events:none;z-index:60;transition:opacity 180ms var(--pep2-e-decel),transform 180ms var(--pep2-e-decel);}
.pep2-share-chip--visible{opacity:1;transform:translateY(0);}
.pep2-share-chip svg{color:#10b981;flex:0 0 auto;}

.pep2-main{padding:0 20px 36px;}
.pep2-identity{margin-top:-32px;display:flex;align-items:center;gap:16px;text-align:left;position:relative;z-index:10;}
.pep2-avatar{display:block;width:104px;height:104px;flex:0 0 auto;border-radius:var(--pep2-r-lg);border:4px solid #fff;box-shadow:var(--pep2-shadow-up);object-fit:cover;background:var(--pep2-muted);}
.pep2-idtext{min-width:0;}
.pep2-name{font-size:20px;line-height:26px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--pep2-fg);}
.pep2-tagline{margin-top:3px;font-size:13px;line-height:18px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--pep2-primary);}
.pep2-meta{display:flex;flex-wrap:wrap;justify-content:flex-start;align-items:center;gap:4px 12px;margin-top:8px;}
.pep2-meta-item{display:inline-flex;align-items:center;gap:5px;font-size:12px;line-height:16px;color:var(--pep2-muted-fg);text-decoration:none;overflow-wrap:anywhere;}
.pep2-meta-item:hover{color:var(--pep2-fg);}
.pep2-bio{margin-top:8px;font-size:13px;line-height:20px;color:var(--pep2-muted-fg);}
.pep2-bio p{margin:0 0 8px;}
.pep2-bio p:last-child{margin-bottom:0;}
.pep2-bio ul,.pep2-bio ol{margin:4px 0 0;padding-left:18px;}
.pep2-bio li{margin:0 0 4px;}
.pep2-bio a{color:var(--pep2-primary);}

.pep2-actions{display:flex;justify-content:center;gap:10px;margin-top:16px;}
.pep2-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;border-radius:var(--pep2-r-md);font-family:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:transform 120ms var(--pep2-e-std),background 180ms var(--pep2-e-std),box-shadow 180ms var(--pep2-e-std),color 180ms var(--pep2-e-std),border-color 180ms var(--pep2-e-std);}
.pep2-btn:active{transform:scale(.97);}
.pep2-btn[disabled]{opacity:.7;pointer-events:none;}
.pep2-btn--sm{padding:10px 16px;font-size:12px;line-height:16px;}
.pep2-btn--block{width:100%;padding:12px 0;font-size:14px;line-height:20px;}
.pep2-btn--soft{background:var(--pep2-muted);color:var(--pep2-fg);}
.pep2-btn--outline{background:var(--pep2-surface);border:1px solid var(--pep2-border);color:var(--pep2-fg);}
.pep2-btn--brand{background:var(--pep2-primary);color:#fff;}
.pep2-btn--wa{background:var(--pep2-wa);color:#fff;}
.pep2-btn--wa-ghost{background:transparent;border:2px solid var(--pep2-primary);color:var(--pep2-primary);}

.pep2-btn--review{width:100%;margin-top:10px;}

.pep2-socials{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;margin-top:16px;}
.pep2-social-tile{width:48px;height:48px;display:grid;place-items:center;border-radius:var(--pep2-r-md);background:var(--pep2-muted);color:var(--pep2-muted-fg);transition:background 180ms var(--pep2-e-std),color 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std),box-shadow 180ms var(--pep2-e-std);}
.pep2-social-tile:active{transform:scale(.95);}

.pep2-section{margin-top:32px;}
.pep2-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:14px;line-height:20px;font-weight:700;color:var(--pep2-fg);}
.pep2-head-ico{width:28px;height:28px;display:grid;place-items:center;border-radius:var(--pep2-r-sm);background:var(--pep2-wash-15);color:var(--pep2-primary);}

.pep2-ptrack{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;}

.pep2-ptrack::-webkit-scrollbar{display:none;}

.pep2-pslide{display:flex;flex-direction:column;flex:0 0 39%;scroll-snap-align:start;border:1px solid var(--pep2-border);border-radius:12px;background:var(--pep2-muted);overflow:hidden;height:280px;}

.pep2-pmedia{position:relative;display:block;width:100%;height:140px;flex:0 0 auto;min-height:0;padding:0;border:none;background:var(--pep2-muted);cursor:zoom-in;}

.pep2-pill{position:absolute;right:8px;bottom:8px;width:20px;height:4px;border-radius:9999px;background:rgb(255 255 255/.8);}

.pep2-psimg{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;}

.pep2-pbody{display:flex;flex-direction:column;flex:1;padding:10px;min-height:0;overflow:hidden;}

.pep2-ptitle{font-size:13px;line-height:18px;font-weight:700;color:#0F172A;word-break:break-word;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}

.pep2-pcta{margin-top:auto;width:100%;display:flex;align-items:center;justify-content:center;gap:4px;padding:8px 6px;border-radius:9999px;background:var(--pep2-wa);color:#fff;font-family:inherit;font-size:10px;line-height:14px;font-weight:600;text-decoration:none;white-space:nowrap;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}

.pep2-pcta:hover{background:var(--pep2-wa-hover);}

.pep2-pcta:active{transform:scale(.98);}

.pep2-svc-list{display:flex;flex-direction:column;gap:12px;}
.pep2-svc{display:flex;align-items:center;gap:12px;padding:14px;border-radius:var(--pep2-r-md);background:var(--pep2-muted);}
.pep2-svc-ico{width:36px;height:36px;flex:0 0 auto;display:grid;place-items:center;border-radius:var(--pep2-r-sm);background:var(--pep2-wash-15);color:var(--pep2-primary);}
.pep2-svc-title{font-size:14px;line-height:20px;font-weight:600;color:var(--pep2-fg);word-break:break-word;}
.pep2-svc-pill{margin-left:auto;flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:8px 10px;border-radius:9999px;background:var(--pep2-wa);color:#fff;font-size:11px;line-height:1;font-weight:600;text-decoration:none;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-svc-pill:active{transform:scale(.95);}
.pep2-svc-more{margin-top:12px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 0;border-radius:9999px;border:none;background:transparent;color:var(--pep2-primary);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-svc-more:hover{background:var(--pep2-wash-15);}
.pep2-svc-more:active{transform:scale(.98);}
.pep2-svc-more-ico{display:flex;transition:transform 180ms var(--pep2-e-std);}
.pep2-svc-more-ico--open{transform:rotate(180deg);}
.pep2-svc-pill:active{transform:scale(.95);}

.pep2-gal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
.pep2-gthumb{aspect-ratio:1/1;padding:0;border:0;border-radius:var(--pep2-r-md);overflow:hidden;background:var(--pep2-muted);cursor:zoom-in;transition:transform 120ms var(--pep2-e-std);}
.pep2-gthumb:active{transform:scale(.95);}
.pep2-gimg{width:100%;height:100%;object-fit:cover;display:block;transition:transform 300ms var(--pep2-e-std),filter 300ms var(--pep2-e-std);}

.pep2-form{display:flex;flex-direction:column;gap:12px;margin-top:12px;}
.pep2-frow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;}
.pep2-field{display:flex;flex-direction:column;gap:4px;}
.pep2-input,.pep2-textarea{width:100%;background:var(--pep2-surface);border:1px solid var(--pep2-border);border-radius:var(--pep2-r-md);font-family:inherit;font-size:14px;line-height:20px;font-weight:400;color:var(--pep2-fg);padding:11px 14px;outline:none;transition:border-color 180ms var(--pep2-e-std),box-shadow 180ms var(--pep2-e-std);}
.pep2-textarea{padding-top:10px;resize:vertical;min-height:76px;}
.pep2-input::placeholder,.pep2-textarea::placeholder{color:var(--pep2-muted-fg);}
.pep2-input:focus,.pep2-textarea:focus{border-color:var(--pep2-primary);box-shadow:0 0 0 3px var(--pep2-halo);}
.pep2-input--error,.pep2-textarea--error{border-color:var(--pep2-error);animation:pep2-shake 300ms var(--pep2-e-std);}
.pep2-input--error:focus,.pep2-textarea--error:focus{box-shadow:0 0 0 3px rgb(239 68 68/.15);}
.pep2-err{font-size:12px;line-height:16px;font-weight:500;color:var(--pep2-error);animation:pep2-err-in 160ms var(--pep2-e-decel);}
.pep2-spin{animation:pep2-spin 800ms linear infinite;}
.pep2-okcard{background:var(--pep2-muted);border-radius:var(--pep2-r-md);padding:24px;text-align:center;}
.pep2-okico{width:56px;height:56px;margin-inline:auto;display:grid;place-items:center;border-radius:9999px;background:var(--pep2-wash-20);color:var(--pep2-primary-active);animation:pep2-pop 350ms var(--pep2-e-spring);}
.pep2-oktitle{margin-top:12px;font-size:15px;line-height:22px;font-weight:600;color:var(--pep2-fg);}
.pep2-oksub{margin-top:4px;font-size:13px;line-height:20px;color:var(--pep2-muted-fg);}
.pep2-oksub em{font-style:italic;}
.pep2-okagain{margin-top:12px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--pep2-primary);cursor:pointer;text-decoration:none;}
.pep2-okagain:hover{text-decoration:underline;text-underline-offset:3px;}

.pep2-footer{margin-top:32px;border-top:1px solid var(--pep2-border);padding:16px 0 20px;text-align:center;}
.pep2-flink{font-size:12px;font-weight:600;color:var(--pep2-primary);text-decoration:none;}
.pep2-flink:hover{text-decoration:underline;text-underline-offset:3px;color:var(--pep2-primary-hover);}
.pep2-fnote{display:block;margin-top:6px;font-size:11px;line-height:15px;color:var(--pep2-muted-fg);text-decoration:none;}
.pep2-fnote:hover{text-decoration:underline;}

.pep2-bar{position:sticky;bottom:0;z-index:40;background:color-mix(in srgb,var(--pep2-surface) 88%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--pep2-border);box-shadow:0 -4px 16px rgb(0 0 0/.04);}
.pep2-bar-in{max-width:448px;margin-inline:auto;display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));}
.pep2-bar-btn{flex:1;min-height:48px;font-size:14px;line-height:20px;}
.pep2-bar-btn--brand:hover{background:var(--pep2-primary-hover);box-shadow:var(--pep2-shadow-up);}
.pep2-bar-btn--wa-ghost{border-width:2px;}
.pep2-bar-icon{width:48px;height:48px;min-height:48px;flex:0 0 auto;padding:0;}

.pep2-overlay{position:fixed;inset:0;z-index:50;background:rgb(15 23 42/.6);opacity:0;visibility:hidden;transition:opacity 240ms var(--pep2-e-decel),visibility 0s linear 240ms;}
.pep2-overlay--open{opacity:1;visibility:visible;transition:opacity 240ms var(--pep2-e-decel);}
.pep2-sheet{position:fixed;left:0;right:0;bottom:0;margin-inline:auto;width:min(448px,100%);z-index:55;background:var(--pep2-surface);border-radius:var(--pep2-r-lg) var(--pep2-r-lg) 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom));transform:translateY(100%);transition:transform 240ms var(--pep2-e-std);}
.pep2-overlay--open .pep2-sheet{transform:translateY(0);transition:transform 320ms var(--pep2-e-spring);}
.pep2-sheet-head{display:flex;align-items:flex-start;gap:12px;padding-right:44px;}
.pep2-sheet-ico{width:40px;height:40px;flex:0 0 auto;display:grid;place-items:center;border-radius:9999px;background:var(--pep2-wash-15);color:var(--pep2-primary);}
.pep2-sheet-title{font-size:16px;line-height:22px;font-weight:700;color:var(--pep2-fg);}
.pep2-sheet-intro{margin-top:2px;font-size:13px;line-height:18px;color:var(--pep2-muted-fg);}
.pep2-xbtn{position:absolute;top:14px;right:14px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:transparent;color:var(--pep2-muted-fg);cursor:pointer;transition:background 180ms var(--pep2-e-std),color 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-xbtn:hover{background:var(--pep2-muted);color:var(--pep2-fg);}
.pep2-xbtn:active{transform:scale(.95);}
.pep2-sheet-body{display:flex;flex-direction:column;gap:12px;margin-top:16px;}
.pep2-lb-stage{position:fixed;inset:0;z-index:55;display:flex;align-items:center;justify-content:center;padding:20px;}
.pep2-lb-img{max-width:92vw;max-height:82vh;border-radius:var(--pep2-r-md);object-fit:contain;animation:pep2-zoom-in 260ms var(--pep2-e-decel);}
.pep2-lb-close{position:absolute;top:12px;right:12px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.16);color:#fff;cursor:pointer;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-lb-close:hover{background:rgb(255 255 255/.26);}
.pep2-lb-close:active{transform:scale(.95);}
.pep2-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:none;border-radius:9999px;background:rgb(255 255 255/.16);color:#fff;cursor:pointer;transition:background 180ms var(--pep2-e-std),transform 120ms var(--pep2-e-std);}
.pep2-lb-nav:hover{background:rgb(255 255 255/.26);}
.pep2-lb-nav:active{transform:translateY(-50%) scale(.95);}
.pep2-lb-nav--prev{left:8px;}
.pep2-lb-nav--next{right:8px;}
.pep2-lb-count{position:absolute;top:14px;left:16px;font-size:12px;font-weight:500;color:#fff;text-shadow:0 1px 4px rgb(0 0 0/.4);}

@media(hover:hover) and (pointer:fine){
.pep2-share-btn:hover{background:rgb(255 255 255/.95);}
.pep2-btn--soft:hover{background:var(--pep2-muted-hover);}
.pep2-btn--outline:hover{border-color:var(--pep2-primary);color:var(--pep2-primary);background:var(--pep2-wash-15);}
.pep2-btn--brand:hover{background:var(--pep2-primary-hover);box-shadow:var(--pep2-shadow-up);}
.pep2-btn--wa:hover,.pep2-svc-pill:hover{background:var(--pep2-wa-hover);}
.pep2-btn--wa-ghost:hover,.pep2-bar-btn--wa-ghost:hover{background:var(--pep2-wash-15);color:var(--pep2-primary-active);border-color:var(--pep2-primary-active);}
.pep2-social-tile:hover{background:var(--pep2-muted-hover);color:var(--pep2-fg);transform:translateY(-2px);box-shadow:var(--pep2-shadow-card);}
.pep2-gthumb:hover .pep2-gimg{transform:scale(1.06);filter:brightness(1.05);}
}

@media(min-width:480px){
.pep2-card{margin:24px 0;border-radius:var(--pep2-r-lg);box-shadow:var(--pep2-shadow-card);overflow:hidden;}
.pep2-lb-img{max-height:86vh;}
}
@media(max-width:359px){
.pep2-avatar{width:84px;height:84px;}
.pep2-name{font-size:17px;line-height:22px;}
.pep2-pslide{flex-basis:43%;}
}

@keyframes pep2-zoom-in{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
@keyframes pep2-pop{0%{opacity:0;transform:scale(.5);}70%{transform:scale(1.08);}100%{opacity:1;transform:scale(1);}}
@keyframes pep2-shake{0%,100%{transform:translateX(0);}20%,60%{transform:translateX(-4px);}40%,80%{transform:translateX(4px);}}
@keyframes pep2-spin{to{transform:rotate(360deg);}}
@keyframes pep2-err-in{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:translateY(0);}}

@media(prefers-reduced-motion:reduce){
.pep2-scope *,.pep2-scope *::before,.pep2-scope *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;}
}
`;

/* ─────────────────────────────────────────────────────────────────────
 * Fallbacks + small helpers
 * ───────────────────────────────────────────────────────────────────── */

const FALLBACK_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='224' height='224' viewBox='0 0 224 224'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#10b981'/><stop offset='1' stop-color='#0ea5e9'/></linearGradient></defs><rect width='224' height='224' fill='url(#g)'/><circle cx='112' cy='92' r='34' fill='none' stroke='white' stroke-opacity='.9' stroke-width='7'/><path d='M52 190c8-30 32-44 60-44s52 14 60 44' fill='none' stroke='white' stroke-opacity='.9' stroke-width='7' stroke-linecap='round'/></svg>",
)}`;

const fallbackMedia = (name: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='450' viewBox='0 0 600 450'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#10b981'/><stop offset='1' stop-color='#0ea5e9'/></linearGradient></defs><rect width='600' height='450' fill='url(#g)'/><rect x='240' y='165' width='120' height='90' rx='10' fill='none' stroke='white' stroke-opacity='.9' stroke-width='6'/><circle cx='300' cy='196' r='12' fill='white' fill-opacity='.9'/><path d='M252 243l26-26 20 20 24-28 26 34' fill='none' stroke='white' stroke-opacity='.9' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/><text x='300' y='305' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' letter-spacing='4' font-size='22' fill='white' fill-opacity='.85'>${name
      .toUpperCase()
      .replace(/[<>&'"]/g, '')}</text></svg>`,
  )}`;

const handleImgError = (event: React.SyntheticEvent<HTMLImageElement>, label = 'Taprevia'): void => {
  const image = event.currentTarget;
  if (image.dataset.pep2fb === '1') return;
  image.dataset.pep2fb = '1';
  image.src =
    image.className.indexOf('pep2-avatar') !== -1 ? FALLBACK_AVATAR : fallbackMedia(label);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;

const BUSY_MS = 900;
const SHEET_CLOSE_MS = 240;

/* ─────────────────────────────────────────────────────────────────────
 * Data derivation — map live vcard/products/services onto the reference shape
 * ───────────────────────────────────────────────────────────────────── */

const WEBSITE_PLATFORMS = new Set(['website', 'site', 'web', 'blog', 'portfolio']);

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

function buildData({
  vcard,
  products,
}: {
  vcard: IVcard;
  products: IProduct[];
}): PantheventData {
  const name =
    vcard.name?.trim() ||
    [vcard.basic?.firstName?.trim(), vcard.basic?.lastName?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    'Profile';

  const tagline =
    [vcard.basic?.jobTitle?.trim(), vcard.basic?.company?.trim()].filter(Boolean).join(' · ') ||
    vcard.occupation?.trim() ||
    '';

  const phoneDisplay = vcard.basic?.phone?.trim() ?? '';
  const phoneRaw = digitsOf(phoneDisplay);

  const email = vcard.basic?.email?.trim() ?? '';

  const website = safeExternalUrl(
    (vcard.socialLinks ?? []).find((link) =>
      WEBSITE_PLATFORMS.has(link.platform.toLowerCase()),
    )?.url,
  );

  const socials = (vcard.socialLinks ?? [])
    .map((link) => ({ network: link.platform.toLowerCase(), url: link.url.trim() }))
    .filter((s) => s.network)
    .map((s) => ({ ...s, url: safeExternalUrl(s.url) }))
    .filter((s) => s.url);

  const productItems = (products ?? [])
    .filter((p) => p && p.active !== false && p.title?.trim())
    .map((p) => ({
      title: p.title!.trim(),
      desc: p.description?.trim() || null,
      imageUrl: p.imageUrl?.trim() || fallbackMedia(name),
    }));

  const services = (vcard.services ?? []).map((s) => s.title?.trim()).filter(Boolean);

  const gallery = (vcard.galleryImages ?? [])
    .map((g) => g?.imageUrl?.trim() ?? '')
    .filter((url) => url.length > 0);

  const avatarUrl = vcard.profileImageUrl?.trim() || FALLBACK_AVATAR;

  // Cover: honour an image cover; otherwise render the brand fallback.
  const heroUrl =
    vcard.coverType !== 'color' && vcard.coverValue?.trim()
      ? vcard.coverValue.trim()
      : fallbackMedia(name);

  return {
    name,
    tagline,
    phoneDisplay,
    phoneRaw,
    email,
    website,
    cardUrl: `/profile/${vcard.urlAlias || ''}`,
    bio: vcard.descriptionHtml?.trim() || null,
    avatarUrl,
    heroUrl,
    socials,
    products: productItems,
    services,
    gallery,
  };
}

function buildWaLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

type OverlayKind = 'closed' | 'open' | 'closing';

/* ─────────────────────────────────────────────────────────────────────
 * Template component (faithful to the reference, data-driven)
 * ───────────────────────────────────────────────────────────────────── */

export function PanthiEventTemplate({
  vcard,
  products,
}: {
  vcard: IVcard;
  products: IProduct[];
}) {
  const data = useMemo(
    () => buildData({ vcard, products }),
    [vcard, products],
  );
  const WA_NUMBER = data.phoneRaw;
  const cardUrl = typeof window !== 'undefined' ? `${window.location.origin}${data.cardUrl}` : data.cardUrl;
  const googleReviewUrl = safeExternalUrl(vcard.reviewAssistant?.googleReviewUrl);

  const buildWa = (message: string): string =>
    WA_NUMBER ? buildWaLink(WA_NUMBER, message) : '#';

  const WA_PRODUCT_MSG = (title: string): string =>
    `Hello ${data.name}! I'd like to enquire about your "${title}" package.`;
  const WA_SERVICE_MSG = (service: string): string =>
    `Hello ${data.name}! I'm interested in ${service}. Please share details.`;
  const WA_BAR_MSG = `Hello ${data.name}! I found your digital card and would like to connect.`;

  const [chipVisible, setChipVisible] = useState<boolean>(false);
  const [sheetState, setSheetState] = useState<OverlayKind>('closed');
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  const CAROUSEL_CLONES = data.products.length;
  const carouselItems = useMemo(
    () => [...data.products, ...data.products, ...data.products],
    [data.products],
  );
  const recentering = useRef<boolean>(false);

  const [leadName, setLeadName] = useState<string>('');
  const [leadEmail, setLeadEmail] = useState<string>('');
  const [leadPhone, setLeadPhone] = useState<string>('');
  const [leadMessage, setLeadMessage] = useState<string>('');
  const [leadErrors, setLeadErrors] = useState<FieldErrors>({});
  const [leadBusy, setLeadBusy] = useState<boolean>(false);
  const [leadSent, setLeadSent] = useState<boolean>(false);

  const [exName, setExName] = useState<string>('');
  const [exPhone, setExPhone] = useState<string>('');
  const [exEmail, setExEmail] = useState<string>('');
  const [exErrors, setExErrors] = useState<FieldErrors>({});
  const [exBusy, setExBusy] = useState<boolean>(false);
  const [exSent, setExSent] = useState<boolean>(false);
  const [servicesExpanded, setServicesExpanded] = useState<boolean>(false);

  const chipTimer = useRef<number | null>(null);
  const sheetTimer = useRef<number | null>(null);
  const leadTimer = useRef<number | null>(null);
  const exTimer = useRef<number | null>(null);
  const productTrackRef = useRef<HTMLDivElement | null>(null);
  const productScrollRaf = useRef<number | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      if (chipTimer.current !== null) window.clearTimeout(chipTimer.current);
      if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
      if (leadTimer.current !== null) window.clearTimeout(leadTimer.current);
      if (exTimer.current !== null) window.clearTimeout(exTimer.current);
      if (productScrollRaf.current !== null) window.cancelAnimationFrame(productScrollRaf.current);
    },
    [],
  );

  const anyOverlayOpen = sheetState === 'open' || lightbox !== null;

  useEffect(() => {
    const track = productTrackRef.current;
    const first = track?.children[0] as HTMLElement | undefined;
    if (!track || !first || CAROUSEL_CLONES === 0) return;
    const step = first.offsetWidth + 12;
    if (step <= 0) return;
    recentering.current = true;
    track.scrollTo({ left: CAROUSEL_CLONES * step, behavior: 'auto' });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        recentering.current = false;
      });
    });
  }, [CAROUSEL_CLONES]);

  const openLightbox = (photos: string[], index: number): void => setLightbox({ photos, index });

  const closeLightbox = (): void => setLightbox(null);

  const stepLightbox = (delta: number): void =>
    setLightbox((current) => {
      if (current === null) return null;
      const total = current.photos.length;
      return { photos: current.photos, index: (current.index + delta + total) % total };
    });

  const handleProductScroll = (): void => {
    if (productScrollRaf.current !== null || recentering.current || CAROUSEL_CLONES === 0)
      return;
    productScrollRaf.current = window.requestAnimationFrame(() => {
      productScrollRaf.current = null;
      if (recentering.current) return;
      const track = productTrackRef.current;
      const first = track?.children[0] as HTMLElement | undefined;
      if (!track || !first) return;
      const step = first.offsetWidth + 12;
      if (step <= 0) return;
      const raw = Math.round(track.scrollLeft / step);
      const real = ((raw % CAROUSEL_CLONES) + CAROUSEL_CLONES) % CAROUSEL_CLONES;
      if (raw < CAROUSEL_CLONES || raw >= 2 * CAROUSEL_CLONES) {
        recentering.current = true;
        track.style.scrollSnapType = 'none';
        track.style.visibility = 'hidden';
        track.scrollTo({ left: (CAROUSEL_CLONES + real) * step, behavior: 'auto' });
        requestAnimationFrame(() => {
          track.style.scrollSnapType = '';
          track.style.visibility = '';
          requestAnimationFrame(() => {
            recentering.current = false;
          });
        });
        return;
      }
    });
  };

  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [anyOverlayOpen]);

  useEffect(() => {
    if (!anyOverlayOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (lightbox !== null) closeLightbox();
        else if (sheetState === 'open') closeSheet();
        return;
      }
      if (lightbox !== null) {
        if (event.key === 'ArrowRight') stepLightbox(1);
        else if (event.key === 'ArrowLeft') stepLightbox(-1);
        else if (event.key === 'Home') setLightbox({ photos: lightbox.photos, index: 0 });
        else if (event.key === 'End')
          setLightbox({ photos: lightbox.photos, index: lightbox.photos.length - 1 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /* Move focus into the modal dialog (or lightbox) when it opens and restore it
     to the triggering control when it closes, so the aria-modal semantics are
     actually enforced for keyboard and screen-reader users. */
  useEffect(() => {
    if (anyOverlayOpen) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      const node = overlayRef.current;
      const focusable = node?.querySelector<HTMLElement>(
        'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? node)?.focus();
    } else {
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
    }
  }, [anyOverlayOpen]);

  const closeSheet = (): void => {
    if (sheetState !== 'open') return;
    setSheetState('closing');
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    sheetTimer.current = window.setTimeout(() => {
      setSheetState('closed');
      setExName('');
      setExPhone('');
      setExEmail('');
      setExErrors({});
      setExBusy(false);
    }, SHEET_CLOSE_MS);
  };

  const openSheet = (): void => {
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    setSheetState('open');
  };

  const copyCardLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cardUrl);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = cardUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        /* clipboard unavailable */
      }
      document.body.removeChild(textarea);
    }
    setChipVisible(true);
    if (chipTimer.current !== null) window.clearTimeout(chipTimer.current);
    chipTimer.current = window.setTimeout(() => setChipVisible(false), 2000);
  };

  const validateLead = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (leadName.trim().length === 0) errors.name = 'Please enter your name';
    const email = leadEmail.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address';
    const phone = leadPhone.trim();
    if (phone.length > 0 && !PHONE_RE.test(phone)) errors.phone = 'Please enter a valid phone number';
    if (leadMessage.trim().length === 0) errors.message = 'Please tell us how we can help';
    return errors;
  };

  const handleLeadSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (leadBusy || !WA_NUMBER) return;
    const errors = validateLead();
    setLeadErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setLeadBusy(true);
    const name = leadName.trim();
    const email = leadEmail.trim();
    const phone = leadPhone.trim();
    const messageLines = [
      `Hello ${data.name}! Here is my enquiry from your digital card.`,
      '',
      `Name: ${name}`,
      phone.length > 0 ? `Phone: ${phone}` : '',
      email.length > 0 ? `Email: ${email}` : '',
      '',
      leadMessage.trim(),
    ].filter((line) => line.length > 0);
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(messageLines.join('\n'))}`, '_blank', 'noopener,noreferrer');
    if (leadTimer.current !== null) window.clearTimeout(leadTimer.current);
    leadTimer.current = window.setTimeout(() => {
      setLeadBusy(false);
      setLeadSent(true);
    }, BUSY_MS);
  };

  const resetLead = (): void => {
    setLeadName('');
    setLeadEmail('');
    setLeadPhone('');
    setLeadMessage('');
    setLeadErrors({});
    setLeadSent(false);
  };

  const handleExchangeSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (exBusy || !WA_NUMBER) return;
    const errors: FieldErrors = {};
    if (exName.trim().length === 0) errors.name = 'Please enter your name';
    if (exPhone.trim().length === 0) errors.phone = 'Please enter your phone';
    else if (!PHONE_RE.test(exPhone.trim())) errors.phone = 'Please enter a valid phone number';
    const email = exEmail.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address';
    setExErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setExBusy(true);
    const name = exName.trim();
    const phone = exPhone.trim();
    const messageLines = [
      `Hello ${data.name}! Sharing my contact details from your digital card.`,
      '',
      `Name: ${name}`,
      `Phone: ${phone}`,
    ];
    if (email.length > 0) messageLines.push(`Email: ${email}`);
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(messageLines.join('\n'))}`, '_blank', 'noopener,noreferrer');
    if (exTimer.current !== null) window.clearTimeout(exTimer.current);
    exTimer.current = window.setTimeout(() => {
      setExBusy(false);
      setExSent(true);
    }, BUSY_MS);
  };

  const downloadVCard = async (): Promise<void> => {
    // Payload comes from the canonical server-side vCard 3.0 builder, so this
    // template cannot drift into its own (unparseable) dialect again.
    const result = await downloadVcfForCard(vcard);
    if (result.status === 'error') console.error('[vcf] download failed:', result.message);
  };

  const trapTabKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return;
    const nodes = event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const galleryTotal = data.gallery.length;

  return (
    <div className="pep2-scope">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div className="pep2-card">
        <header className="pep2-hero">
          {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
          <img
            className="pep2-hero-img"
            src={data.heroUrl}
            alt=""
            width={896}
            height={352}
            fetchPriority="high"
            onError={(e) => handleImgError(e, data.name)}
          />
          <span className="pep2-hero-dim" aria-hidden="true" />
          <span className="pep2-hero-fade" aria-hidden="true" />
          <button
            type="button"
            className="pep2-share-btn"
            onClick={() => void copyCardLink()}
            aria-label="Copy profile link"
          >
            <Icon name="share" size={18} />
          </button>
          <span
            className={chipVisible ? 'pep2-share-chip pep2-share-chip--visible' : 'pep2-share-chip'}
            role="status"
            aria-live="polite"
          >
            <Icon name="check" size={14} />
            Link copied!
          </span>
        </header>

        <main className="pep2-main">
          <section className="pep2-identity">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
            <img
              className="pep2-avatar"
              src={data.avatarUrl}
              alt={data.name}
              width={112}
              height={112}
              onError={(e) => handleImgError(e, data.name)}
            />
            <div className="pep2-idtext">
              <h1 className="pep2-name">{data.name}</h1>
              {data.tagline ? <p className="pep2-tagline">{data.tagline}</p> : null}
              <div className="pep2-meta">
                {data.phoneRaw && (
                  <a className="pep2-meta-item" href={`tel:+${data.phoneRaw}`}>
                    <Icon name="phone" size={14} />
                    {data.phoneDisplay}
                  </a>
                )}
                {data.email && (
                  <a className="pep2-meta-item" href={`mailto:${data.email.replace(/[\r\n<>"]/g, '')}`}>
                    <Icon name="mail" size={14} />
                    {data.email}
                  </a>
                )}
              </div>
              {data.bio ? (
                /* SECURITY: descriptionHtml must be sanitized server-side before render.
                   Rendered as trusted rich text to match the other templates and the
                   builder's rich-text editor. */
                <div
                  className="pep2-bio"
                  dangerouslySetInnerHTML={{ __html: data.bio }}
                />
              ) : null}
            </div>
          </section>

          <div className="pep2-actions">
            <button type="button" className="pep2-btn pep2-btn--sm pep2-btn--soft" onClick={downloadVCard}>
              <Icon name="user-plus" size={14} />
              Add to Contacts
            </button>
            {WA_NUMBER ? (
            <button
              type="button"
              className="pep2-btn pep2-btn--sm pep2-btn--outline"
              onClick={openSheet}
              aria-expanded={sheetState === 'open'}
              aria-controls="pep2-sheet"
            >
              <Icon name="exchange" size={14} />
              Exchange Contact
            </button>
            ) : null}
          </div>
          {googleReviewUrl ? (
            <a
              className="pep2-btn pep2-btn--sm pep2-btn--soft pep2-btn--review"
              href={googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Rate ${data.name} on Google`}
            >
              <Icon name="star" size={14} />
              Rate us on Google
            </a>
          ) : null}

          {data.socials.length > 0 ? (
            <div className="pep2-socials">
              {data.socials.map((social, index) => (
                <a
                  key={`${social.network}-${index}`}
                  className="pep2-social-tile"
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${brandLabelFromUrl(social.url)} — ${data.name}`}
                >
                  {/* Fa6 brand icon derived from the link hostname — covers
                      TikTok/Spotify/Telegram/etc. and falls back to FaGlobe. */}
                  {getBrandIcon(social.url)}
                </a>
              ))}
            </div>
          ) : null}

          {data.products.length > 0 ? (
            <section className="pep2-section" aria-labelledby="pep2-products-head">
            <h2 className="pep2-head" id="pep2-products-head">
              <span className="pep2-head-ico">
                <Icon name="package" size={16} />
              </span>
              Products
            </h2>
            <div
              className="pep2-pcarousel"
              role="region"
              aria-roledescription="carousel"
              aria-label="Products photo carousel"
            >
              <div
                className="pep2-ptrack"
                ref={productTrackRef}
                onScroll={handleProductScroll}
                tabIndex={0}
                aria-label={`Swipe between ${CAROUSEL_CLONES} product photos`}
              >
                {carouselItems.map((product, idx) => {
                  const realIndex = idx % CAROUSEL_CLONES;
                  return (
                    <article key={`${product.title}-${idx}`} className="pep2-pslide">
                      <button
                        type="button"
                        className="pep2-pmedia"
                        onClick={() =>
                          openLightbox(
                            data.products.map((item) => item.imageUrl),
                            realIndex,
                          )
                        }
                        aria-label={`Open ${product.title} photo`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
                        <img
                          className="pep2-psimg"
                          src={product.imageUrl}
                          alt={`${product.title} photo`}
                          width={600}
                          height={450}
                          loading="lazy"
                          decoding="async"
                          onError={(e) => handleImgError(e, data.name)}
                        />
                        <span className="pep2-pill" aria-hidden="true" />
                      </button>
                      <div className="pep2-pbody">
                        <h3 className="pep2-ptitle">{product.title}</h3>
                        {WA_NUMBER ? (
                        <a
                          className="pep2-pcta"
                          href={buildWa(WA_PRODUCT_MSG(product.title))}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Enquire about ${product.title} on WhatsApp`}
                        >
                          <Icon name="chat" size={16} />
                          Enquire on WhatsApp
                        </a>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
            </section>
          ) : null}

          {data.services.length > 0 ? (
            <section className="pep2-section" aria-labelledby="pep2-services-head">
            <h2 className="pep2-head" id="pep2-services-head">
              <span className="pep2-head-ico">
                <Icon name="wrench" size={16} />
              </span>
              Services
            </h2>
            <div className="pep2-svc-list">
              {(servicesExpanded ? data.services : data.services.slice(0, VISIBLE_SERVICES)).map(
                (service, index) => (
                  <div key={`${service}-${index}`} className="pep2-svc">
                    <span className="pep2-svc-ico">
                      <Icon name={serviceIconFor(service)} size={18} />
                    </span>
                    <span className="pep2-svc-title">{service}</span>
                    {WA_NUMBER ? (
                    <a
                      className="pep2-svc-pill"
                      href={buildWa(WA_SERVICE_MSG(service))}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Ask about ${service} on WhatsApp`}
                    >
                      <Icon name="chat" size={12} />
                      WhatsApp
                    </a>
                    ) : null}
                  </div>
                ),
              )}
              {data.services.length > VISIBLE_SERVICES ? (
                <button
                  type="button"
                  className="pep2-svc-more"
                  onClick={() => setServicesExpanded((value) => !value)}
                  aria-expanded={servicesExpanded}
                >
                  {servicesExpanded ? 'Show less' : `Show all ${data.services.length} services`}
                  <span
                    className={
                      servicesExpanded
                        ? 'pep2-svc-more-ico pep2-svc-more-ico--open'
                        : 'pep2-svc-more-ico'
                    }
                    aria-hidden="true"
                  >
                    <Icon name="chevron-down" size={14} />
                  </span>
                </button>
              ) : null}
            </div>
            </section>
          ) : null}

          {data.gallery.length > 0 ? (
            <section className="pep2-section" aria-labelledby="pep2-gallery-head">
            <h2 className="pep2-head" id="pep2-gallery-head">
              <span className="pep2-head-ico">
                <Icon name="images" size={16} />
              </span>
              Gallery
            </h2>
            <div className="pep2-gal">
              {data.gallery.map((imageUrl, index) => (
                <button
                  key={`${imageUrl}-${index}`}
                  type="button"
                  className="pep2-gthumb"
                  onClick={() => openLightbox(data.gallery, index)}
                  aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
                  <img
                    className="pep2-gimg"
                    src={imageUrl}
                    alt={`${data.name} gallery photo ${index + 1}`}
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => handleImgError(e, data.name)}
                  />
                </button>
              ))}
            </div>
            </section>
          ) : null}

          {WA_NUMBER ? (
            <section className="pep2-section" aria-labelledby="pep2-contact-head">
            <h2 className="pep2-head" id="pep2-contact-head">
              <span className="pep2-head-ico">
                <Icon name="mail" size={16} />
              </span>
              Get in touch
            </h2>
            {leadSent ? (
              <div className="pep2-okcard">
                <span className="pep2-okico">
                  <Icon name="check" size={26} />
                </span>
                <p className="pep2-oktitle">Thanks! We&rsquo;ll be in touch.</p>
                <p className="pep2-oksub">Your message has been sent to {data.name}.</p>
                <button type="button" className="pep2-okagain" onClick={resetLead}>
                  Send another message
                </button>
              </div>
            ) : (
              <form className="pep2-form" onSubmit={handleLeadSubmit} noValidate>
                <div className="pep2-field">
                  <label className="pep2-sr-only" htmlFor="pep2-lead-name">
                    Your name
                  </label>
                  <input
                    id="pep2-lead-name"
                    className={leadErrors.name ? 'pep2-input pep2-input--error' : 'pep2-input'}
                    type="text"
                    placeholder="Your name"
                    autoComplete="name"
                    value={leadName}
                    aria-invalid={leadErrors.name ? true : undefined}
                    aria-describedby={leadErrors.name ? 'pep2-lead-name-err' : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setLeadName(event.target.value);
                      setLeadErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                  />
                  {leadErrors.name ? (
                    <p className="pep2-err" id="pep2-lead-name-err" role="alert">
                      {leadErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="pep2-frow">
                  <div className="pep2-field">
                    <label className="pep2-sr-only" htmlFor="pep2-lead-email">
                      Email
                    </label>
                    <input
                      id="pep2-lead-email"
                      className={leadErrors.email ? 'pep2-input pep2-input--error' : 'pep2-input'}
                      type="email"
                      placeholder="you@email.com"
                      autoComplete="email"
                      value={leadEmail}
                      aria-invalid={leadErrors.email ? true : undefined}
                      aria-describedby={leadErrors.email ? 'pep2-lead-email-err' : undefined}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setLeadEmail(event.target.value);
                        setLeadErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                    />
                    {leadErrors.email ? (
                      <p className="pep2-err" id="pep2-lead-email-err" role="alert">
                        {leadErrors.email}
                      </p>
                    ) : null}
                  </div>
                  <div className="pep2-field">
                    <label className="pep2-sr-only" htmlFor="pep2-lead-phone">
                      Phone
                    </label>
                    <input
                      id="pep2-lead-phone"
                      className={leadErrors.phone ? 'pep2-input pep2-input--error' : 'pep2-input'}
                      type="tel"
                      placeholder="+91 …"
                      autoComplete="tel"
                      value={leadPhone}
                      aria-invalid={leadErrors.phone ? true : undefined}
                      aria-describedby={leadErrors.phone ? 'pep2-lead-phone-err' : undefined}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setLeadPhone(event.target.value);
                        setLeadErrors((prev) => ({ ...prev, phone: undefined }));
                      }}
                    />
                    {leadErrors.phone ? (
                      <p className="pep2-err" id="pep2-lead-phone-err" role="alert">
                        {leadErrors.phone}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="pep2-field">
                  <label className="pep2-sr-only" htmlFor="pep2-lead-message">
                    How can I help you?
                  </label>
                  <textarea
                    id="pep2-lead-message"
                    className={
                      leadErrors.message ? 'pep2-textarea pep2-textarea--error' : 'pep2-textarea'
                    }
                    rows={3}
                    placeholder="How can I help you?"
                    value={leadMessage}
                    aria-invalid={leadErrors.message ? true : undefined}
                    aria-describedby={leadErrors.message ? 'pep2-lead-message-err' : undefined}
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                      setLeadMessage(event.target.value);
                      setLeadErrors((prev) => ({ ...prev, message: undefined }));
                    }}
                  />
                  {leadErrors.message ? (
                    <p className="pep2-err" id="pep2-lead-message-err" role="alert">
                      {leadErrors.message}
                    </p>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="pep2-btn pep2-btn--brand pep2-btn--block"
                  disabled={leadBusy || !WA_NUMBER}
                >
                  {leadBusy ? (
                    <>
                      <span className="pep2-spin">
                        <Icon name="share" size={16} />
                      </span>
                      Sending…
                    </>
                  ) : (
                    'Send Message'
                  )}
                </button>
              </form>
            )}
            </section>
          ) : null}

          <footer className="pep2-footer">
            <a
              className="pep2-flink"
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Powered by Taprevia
            </a>
            <a
              className="pep2-fnote"
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Click here to create your digital business card
            </a>
          </footer>
        </main>
      </div>

      <nav className="pep2-bar" aria-label="Quick actions">
        <div className="pep2-bar-in">
          {data.phoneRaw ? (
            <a className="pep2-btn pep2-btn--brand pep2-bar-btn pep2-bar-btn--brand" href={`tel:+${data.phoneRaw}`}>
              <Icon name="phone" size={16} />
              Call
            </a>
          ) : null}
          {WA_NUMBER ? (
          <a
            className="pep2-btn pep2-btn--wa-ghost pep2-bar-btn pep2-bar-btn--wa-ghost"
            href={buildWa(WA_BAR_MSG)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size={16} />
            WhatsApp
          </a>
          ) : null}
          <button
            type="button"
            className="pep2-btn pep2-btn--soft pep2-bar-icon"
            onClick={downloadVCard}
            aria-label="Download contact card (.vcf)"
          >
            <Icon name="user-plus" size={18} />
          </button>
        </div>
      </nav>

      {sheetState !== 'closed' ? (
        <div
          ref={overlayRef}
          className={sheetState === 'open' ? 'pep2-overlay pep2-overlay--open' : 'pep2-overlay'}
          onClick={() => closeSheet()}
          role="presentation"
          onKeyDown={trapTabKeys}
        >
          <div
            className="pep2-sheet"
            id="pep2-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pep2-sheet-title"
            onClick={(event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <button
              type="button"
              className="pep2-xbtn"
              onClick={() => closeSheet()}
              aria-label="Close dialog"
            >
              <Icon name="close" size={18} />
            </button>
            <div className="pep2-sheet-head">
              <span className="pep2-sheet-ico">
                <Icon name="exchange" size={20} />
              </span>
              <div>
                <h2 className="pep2-sheet-title" id="pep2-sheet-title">
                  Exchange Contact
                </h2>
                <p className="pep2-sheet-intro">Share your details with {data.name}</p>
              </div>
            </div>
            {exSent ? (
              <div className="pep2-okcard" style={{ marginTop: 16 }}>
                <span className="pep2-okico">
                  <Icon name="check" size={26} />
                </span>
                <p className="pep2-oktitle">Contact sent successfully!</p>
                <p className="pep2-oksub">
                  <em>Your contact details have been shared with {data.name}.</em>
                </p>
              </div>
            ) : (
              <form className="pep2-sheet-body" onSubmit={handleExchangeSubmit} noValidate>
                <div className="pep2-field">
                  <label className="pep2-sr-only" htmlFor="pep2-ex-name">
                    Your Name
                  </label>
                  <input
                    id="pep2-ex-name"
                    className={exErrors.name ? 'pep2-input pep2-input--error' : 'pep2-input'}
                    type="text"
                    placeholder="Your Name"
                    autoComplete="name"
                    value={exName}
                    aria-invalid={exErrors.name ? true : undefined}
                    aria-describedby={exErrors.name ? 'pep2-ex-name-err' : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExName(event.target.value);
                      setExErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                  />
                  {exErrors.name ? (
                    <p className="pep2-err" id="pep2-ex-name-err" role="alert">
                      {exErrors.name}
                    </p>
                  ) : null}
                </div>
                <div className="pep2-field">
                  <label className="pep2-sr-only" htmlFor="pep2-ex-phone">
                    Your Phone
                  </label>
                  <input
                    id="pep2-ex-phone"
                    className={exErrors.phone ? 'pep2-input pep2-input--error' : 'pep2-input'}
                    type="tel"
                    placeholder="Your Phone"
                    autoComplete="tel"
                    value={exPhone}
                    aria-invalid={exErrors.phone ? true : undefined}
                    aria-describedby={exErrors.phone ? 'pep2-ex-phone-err' : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExPhone(event.target.value);
                      setExErrors((prev) => ({ ...prev, phone: undefined }));
                    }}
                  />
                  {exErrors.phone ? (
                    <p className="pep2-err" id="pep2-ex-phone-err" role="alert">
                      {exErrors.phone}
                    </p>
                  ) : null}
                </div>
                <div className="pep2-field">
                  <label className="pep2-sr-only" htmlFor="pep2-ex-email">
                    Your Email
                  </label>
                  <input
                    id="pep2-ex-email"
                    className={exErrors.email ? 'pep2-input pep2-input--error' : 'pep2-input'}
                    type="email"
                    placeholder="Your Email"
                    autoComplete="email"
                    value={exEmail}
                    aria-invalid={exErrors.email ? true : undefined}
                    aria-describedby={exErrors.email ? 'pep2-ex-email-err' : undefined}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      setExEmail(event.target.value);
                      setExErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                  />
                  {exErrors.email ? (
                    <p className="pep2-err" id="pep2-ex-email-err" role="alert">
                      {exErrors.email}
                    </p>
                  ) : null}
                </div>
                <button
                  type="submit"
                  className="pep2-btn pep2-btn--brand pep2-btn--block"
                  disabled={exBusy || !WA_NUMBER}
                >
                  {exBusy ? (
                    <>
                      <span className="pep2-spin">
                        <Icon name="share" size={16} />
                      </span>
                      Sending…
                    </>
                  ) : (
                    'Share My Contact'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {lightbox !== null ? (
        <div
          ref={overlayRef}
          className="pep2-overlay pep2-overlay--open"
          onClick={closeLightbox}
          role="presentation"
          onKeyDown={trapTabKeys}
        >
          <div
            className="pep2-lb-stage"
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
            onClick={(event: React.MouseEvent<HTMLDivElement>) => event.stopPropagation()}
          >
            <span className="pep2-lb-count">
              {lightbox.index + 1} / {lightbox.photos.length}
            </span>
            <button
              type="button"
              className="pep2-lb-close"
              onClick={closeLightbox}
              aria-label="Close photo viewer"
            >
              <Icon name="close" size={18} />
            </button>
            <button
              type="button"
              className="pep2-lb-nav pep2-lb-nav--prev"
              onClick={() => stepLightbox(-1)}
              aria-label="Previous photo"
            >
              <Icon name="chevron-left" size={20} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
            <img
              key={lightbox.index}
              className="pep2-lb-img"
              src={lightbox.photos[lightbox.index]}
              alt={`${data.name} photo ${lightbox.index + 1}`}
              onError={(e) => handleImgError(e, data.name)}
            />
            <button
              type="button"
              className="pep2-lb-nav pep2-lb-nav--next"
              onClick={() => stepLightbox(1)}
              aria-label="Next photo"
            >
              <Icon name="chevron-right" size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
