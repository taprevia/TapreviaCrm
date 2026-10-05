'use client';

/**
 * ProfessionalProfileTemplate — "Professional Profile" smart card (`professional-profile`).
 *
 * Faithful recreation of the reference digital profile card
 * (https://sample-temp-zeta.vercel.app/) inside the Taprevia CRM.
 *
 * Every string, image, link, product, service and gallery tile is sourced from
 * the live `vcard` / `products` data — nothing from the reference business is
 * hard-coded. Sections collapse when their source data is missing, and CTA
 * actions (phone / WhatsApp / website) only render when the backing value
 * exists.
 *
 * Reused CRM primitives (no duplicates created):
 *   - vCard download      → existing `/api/public/cards/[alias]/vcf` endpoint
 *   - Quick actions dock  → the platform <StickyDock /> already rendered by
 *                           PublicVcardRenderer (Call · WhatsApp · Share ·
 *                           Add to Contact), so this template adds no
 *                           second sticky bar.
 *   - Brand glyphs        → getBrandIcon(url)
 *   - Safe links          → safeExternalUrl
 *   - Avatar/media fallback → same gradient data-URIs as panthi-event
 *
 * WhatsApp lead + exchange sheets reuse the same wa.me delivery pattern as the
 * existing templates. This is intentionally a client component — it drives the
 * carousel, exchange sheet and photo lightbox state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  FaBoxOpen,
  FaCheck,
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaCube,
  FaEnvelope,
  FaFire,
  FaGlobe,
  FaHeart,
  FaImages,
  FaIndustry,
  FaPhone,
  FaRecycle,
  FaRightLeft,
  FaShareNodes,
  FaSpinner,
  FaUserPlus,
  FaWhatsapp,
  FaWrench,
  FaXmark,
} from 'react-icons/fa6';
import { getBrandIcon } from '@/utils/getBrandIcon';
import { safeExternalUrl } from '@/lib/safe-url';
import { downloadVcfForCard, requestVcfDownload } from '@/lib/vcf-download';
import type { IProduct, IVcard } from '../types';
import { SafeHtml } from '@/lib/sanitizer';

/* ─────────────────────────────────────────────────────────────────────
 * Data view-model (bridge between CRM schema and the reference layout)
 * ───────────────────────────────────────────────────────────────────── */

interface PPProduct {
  title: string;
  imageUrl: string;
}

interface PPSocial {
  network: string;
  url: string;
}

interface PPData {
  name: string;
  tagline: string;
  avatarUrl: string;
  heroUrl: string;
  bioHtml: string;
  phoneDisplay: string;
  phoneRaw: string;
  phone2Display: string;
  phone2Raw: string;
  email: string;
  website: string;
  cardUrl: string;
  socials: PPSocial[];
  products: PPProduct[];
  services: string[];
  gallery: string[];
  hasPhone: boolean;
}

const WEBSITE_PLATFORMS = new Set(['website', 'site', 'web', 'blog', 'portfolio']);

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

function buildData({ vcard, products }: { vcard: IVcard; products: IProduct[] }): PPData {
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
  const phone2Display = vcard.basic?.alternatePhone?.trim() ?? '';
  const phone2Raw = digitsOf(phone2Display);
  const email = vcard.basic?.email?.trim() ?? '';

  const website = safeExternalUrl(
    (vcard.socialLinks ?? []).find((link) =>
      WEBSITE_PLATFORMS.has((link.platform ?? '').toLowerCase()),
    )?.url,
  );

  const socials = (vcard.socialLinks ?? [])
    .filter((link) => !WEBSITE_PLATFORMS.has((link.platform ?? '').toLowerCase()))
    .map((link) => ({
      network: (link.platform ?? '').trim().toLowerCase() || 'website',
      url: safeExternalUrl(link.url),
    }))
    .filter((s) => s.url.length > 0);

  // Every product the customer added is shown; ones lacking an image get the
  // branded gradient fallback tile (same fill-in as the avatar and cover).
  const productItems = (products ?? [])
    .filter((p) => p?.active !== false && p.title?.trim())
    .map((p) => ({
      title: p.title!.trim(),
      imageUrl: p.imageUrl?.trim() || fallbackMedia(name),
    }));

  const services = (vcard.services ?? []).map((s) => s.title?.trim()).filter(Boolean);

  const gallery = (vcard.galleryImages ?? [])
    .map((g) => g?.imageUrl?.trim() ?? '')
    .filter((url) => url.length > 0);

  const heroUrl =
    vcard.coverType !== 'color' && vcard.coverValue?.trim()
      ? vcard.coverValue.trim()
      : fallbackMedia(name);

  return {
    name,
    tagline,
    avatarUrl: vcard.profileImageUrl?.trim() || FALLBACK_AVATAR,
    heroUrl,
    bioHtml: vcard.descriptionHtml?.trim() || '',
    phoneDisplay,
    phoneRaw,
    phone2Display,
    phone2Raw,
    email,
    website,
    cardUrl: `/profile/${vcard.urlAlias || ''}`,
    socials,
    products: productItems,
    services,
    gallery,
    hasPhone: phoneRaw.length > 0,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Fallbacks + small helpers (same assets as the other templates)
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

const handleImgError = (
  event: React.SyntheticEvent<HTMLImageElement>,
  kind: 'avatar' | 'media',
  label = 'Taprevia',
): void => {
  const image = event.currentTarget;
  if (image.dataset.ppfb === '1') return;
  image.dataset.ppfb = '1';
  image.src = kind === 'avatar' ? FALLBACK_AVATAR : fallbackMedia(label);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,}$/;
const VISIBLE_SERVICES = 3;
const BUSY_MS = 900;

function buildWaLink(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/* ─────────────────────────────────────────────────────────────────────
 * Service icon match (keyword-based, fa6 glyphs)
 * ───────────────────────────────────────────────────────────────────── */

const SERVICE_ICONS: Array<{ keywords: string[]; icon: ReactNode }> = [
  { keywords: ['recycl', 'scrap', 'dross', 'sort'], icon: <FaRecycle size={18} /> },
  { keywords: ['extrud', 'alloy', 'ingot', 'smelt', 'fur'], icon: <FaFire size={18} /> },
  { keywords: ['plant', 'machin', 'turnkey', 'industr'], icon: <FaIndustry size={18} /> },
  { keywords: ['weld', 'fabric', 'structur'], icon: <FaWrench size={18} /> },
  { keywords: ['cable', 'wire', 'copper', 'lead', 'metal'], icon: <FaCube size={18} /> },
  { keywords: ['annual', 'wedding', 'birthday', 'party', 'event'], icon: <FaHeart size={18} /> },
];

const SERVICE_FALLBACK = <FaGlobe size={18} />;

function ServiceIcon({ service }: { service: string }): ReactNode {
  const label = service.toLowerCase();
  const hit = SERVICE_ICONS.find((entry) => entry.keywords.some((k) => label.includes(k)));
  return hit?.icon ?? SERVICE_FALLBACK;
}

/* ─────────────────────────────────────────────────────────────────────
 * Scoped stylesheet (shimmer, scrollbar, zoom, bio prose)
 * ───────────────────────────────────────────────────────────────────── */

const STYLES = `
.ppc-shimmer{background-image:linear-gradient(110deg,#f4f4f5 40%,#e4e4e7,#f4f4f5 60%);background-size:200% 100%;animation:ppcShimmer 1.6s linear infinite}
@keyframes ppcShimmer{0%{background-position:200% 0}to{background-position:-200% 0}}
.ppc-scroll{scrollbar-width:thin;scrollbar-color:#d4d4d8 transparent}
.ppc-scroll::-webkit-scrollbar{height:6px}
.ppc-scroll::-webkit-scrollbar-track{background:transparent;margin-inline:12px}
.ppc-scroll::-webkit-scrollbar-thumb{background-color:#d4d4d8;border-radius:9999px}
.ppc-ptrack{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.ppc-ptrack::-webkit-scrollbar{display:none}
.ppc-pslide{flex:0 0 72%;scroll-snap-align:center;max-width:290px}
.ppc-fade-in{animation:ppcFadeIn .24s ease-out}
@keyframes ppcFadeIn{from{opacity:0}to{opacity:1}}
.ppc-zoom-in{animation:ppcZoomIn .26s cubic-bezier(.05,.7,.1,1)}
@keyframes ppcZoomIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
.ppc-pop{animation:ppcPop .35s cubic-bezier(.32,.72,0,1)}
@keyframes ppcPop{0%{opacity:0;transform:scale(.5)}70%{transform:scale(1.08)}to{opacity:1;transform:scale(1)}}
.ppc-bio p{margin:0 0 8px}.ppc-bio p:last-child{margin-bottom:0}
.ppc-bio ul,.ppc-bio ol{margin:4px 0 0;padding-left:18px}
.ppc-bio li{margin:0 0 4px}
.ppc-bio a{color:#047857;text-decoration:underline}
@media(prefers-reduced-motion:reduce){.ppc-shimmer{animation:none}.ppc-fade-in,.ppc-zoom-in,.ppc-pop{animation:none}}
`;

/* ─────────────────────────────────────────────────────────────────────
 * Shared classes (verbatim from the reference)
 * ───────────────────────────────────────────────────────────────────── */

const MT =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-60 motion-reduce:transform-none';

const SECTION_HEAD = 'mb-3 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-900';
const SECTION_ICON = 'grid h-7 w-7 place-items-center rounded-lg bg-emerald-100/70 text-emerald-700';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

const INNER_LINK =
  'inline-flex items-center gap-1.5 py-1.5 text-xs text-zinc-500 transition-colors duration-300 hover:text-zinc-900 ' +
  FOCUS +
  ' [&>svg]:text-emerald-700';

const SOCIAL_TILE =
  'grid h-12 w-12 place-items-center rounded-xl border border-black/5 bg-white/70 text-zinc-500 shadow-sm backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-emerald-50 hover:text-emerald-700 hover:shadow-[0_8px_20px_rgba(16,185,129,0.15)] active:scale-[0.98] motion-reduce:transform-none ' +
  FOCUS;

const WA_PILL =
  'flex items-center justify-center gap-1 rounded-full bg-[#25D366] text-zinc-950 transition-all duration-300 ease-out hover:bg-[#1fc35b] active:scale-[0.98] motion-reduce:transform-none ' +
  FOCUS;

function SectionHeading({
  id,
  icon,
  children,
}: {
  id: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} className={SECTION_HEAD}>
      <span className={SECTION_ICON} aria-hidden="true">
        {icon}
      </span>
      {children}
    </div>
  );
}

const INPUT_BASE =
  'w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition-colors duration-300 placeholder:text-zinc-500 focus:ring-2';
const INPUT_OK = 'border-black/[0.08] focus:border-emerald-600 focus:ring-emerald-500/20';
const INPUT_ERR = 'border-red-400 focus:border-red-400 focus:ring-red-100';

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-zinc-700">
      {children}
    </label>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs font-medium text-red-500">
      {children}
    </p>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Template component
 * ───────────────────────────────────────────────────────────────────── */

export function ProfessionalProfileTemplate({
  vcard,
  products,
}: {
  vcard: IVcard;
  products: IProduct[];
}) {
  const data = useMemo(() => buildData({ vcard, products }), [vcard, products]);
  const WA_NUMBER = data.phoneRaw;

  const buildWa = (message: string): string => (WA_NUMBER ? buildWaLink(WA_NUMBER, message) : '#');
  const WA_PRODUCT_MSG = (title: string): string =>
    `Hello ${data.name}! I'd like to enquire about your "${title}" package.`;
  const WA_SERVICE_MSG = (service: string): string =>
    `Hello ${data.name}! I'm interested in ${service}. Please share details.`;

  const [chipVisible, setChipVisible] = useState(false);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const chipTimer = useRef<number | null>(null);

  // Exchange sheet
  const [sheet, setSheet] = useState<'closed' | 'open' | 'closing'>('closed');
  const sheetTimer = useRef<number | null>(null);
  const exchangeBtnRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [exName, setExName] = useState('');
  const [exPhone, setExPhone] = useState('');
  const [exEmail, setExEmail] = useState('');
  const [exErrors, setExErrors] = useState<FieldErrors>({});
  const [exBusy, setExBusy] = useState(false);
  const [exSent, setExSent] = useState(false);
  // Set when a vCard download was refused by the endpoint's contact-details
  // gate (HTTP 428), so the same sheet collects the details and retries.
  const [exSavingVcf, setExSavingVcf] = useState(false);
  // Form-level failure (download/network), distinct from per-field errors.
  const [exFormError, setExFormError] = useState<string | null>(null);

  // Lead form
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadMessage, setLeadMessage] = useState('');
  const [leadErrors, setLeadErrors] = useState<FieldErrors>({});
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadSent, setLeadSent] = useState(false);
  const leadTimer = useRef<number | null>(null);

  // Photo lightbox
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);
  const [productActive, setProductActive] = useState(0);
  const productTrackRef = useRef<HTMLDivElement | null>(null);
  const productScrollRaf = useRef<number | null>(null);
  const productRecentering = useRef(false);

  // The products section is a swipe/snap carousel — mirror of the reference.
  // The list is cloned 3× and recentered on swipe so it loops infinitely.
  const CAROUSEL_CLONES = data.products.length;
  const carouselItems = useMemo(
    () => [...data.products, ...data.products, ...data.products],
    [data.products],
  );

  useEffect(
    () => () => {
      if (chipTimer.current !== null) window.clearTimeout(chipTimer.current);
      if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
      if (leadTimer.current !== null) window.clearTimeout(leadTimer.current);
      if (productScrollRaf.current !== null) window.cancelAnimationFrame(productScrollRaf.current);
    },
    [],
  );

  const anyOverlay = sheet === 'open' || lightbox !== null;

  useEffect(() => {
    if (!anyOverlay) return undefined;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [anyOverlay]);

  useEffect(() => {
    if (!anyOverlay) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (lightbox !== null) setLightbox(null);
      else if (sheet === 'open') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeSheet is stable
  }, [anyOverlay, lightbox, sheet]);

  useEffect(() => {
    if (sheet !== 'open') return;
    const timer = window.setTimeout(() => nameInputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [sheet]);

  const closeSheet = (): void => {
    if (sheet !== 'open') return;
    setSheet('closing');
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    sheetTimer.current = window.setTimeout(() => {
      setSheet('closed');
      setExName('');
      setExPhone('');
      setExEmail('');
      setExErrors({});
      setExBusy(false);
      setExSavingVcf(false);
      exchangeBtnRef.current?.focus();
    }, 220);
  };

  const copyCardLink = async (): Promise<void> => {
    const url = `${window.location.origin}${data.cardUrl}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
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

  const downloadVCard = async (): Promise<void> => {
    // Goes through the API endpoint so the payload is the canonical vCard 3.0
    // build and the endpoint's gate/analytics cannot be bypassed.
    const result = await downloadVcfForCard(vcard);
    if (result.status === 'gateRequired') {
      // The tenant requires contact details before the card can be saved, so
      // reuse the exchange sheet to collect them and retry.
      setExFormError(null);
      setExSavingVcf(true);
      setSheet('open');
      return;
    }
    if (result.status === 'error') {
      console.error('[vcf] download failed:', result.message);
      setExFormError('Could not save the contact. Please try again.');
      setExSavingVcf(false);
      setSheet('open');
    }
  };

  const openLightbox = (photos: string[], index: number): void =>
    setLightbox({ photos, index });

  const stepLightbox = (delta: number): void =>
    setLightbox((current) => {
      if (current === null) return null;
      const total = current.photos.length;
      return { photos: current.photos, index: (current.index + delta + total) % total };
    });

  // Center the carousel on the middle clone copy once the track is laid out.
  useEffect(() => {
    const track = productTrackRef.current;
    const slide = track?.children[0] as HTMLElement | undefined;
    if (!track || !slide || CAROUSEL_CLONES === 0) return;
    const step = slide.offsetWidth + 12;
    if (step <= 0) return;
    productRecentering.current = true;
    track.scrollTo({ left: CAROUSEL_CLONES * step, behavior: 'auto' });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        productRecentering.current = false;
      });
    });
  }, [CAROUSEL_CLONES]);

  const handleTrackScroll = (): void => {
    if (productScrollRaf.current !== null || productRecentering.current || CAROUSEL_CLONES === 0)
      return;
    productScrollRaf.current = window.requestAnimationFrame(() => {
      productScrollRaf.current = null;
      if (productRecentering.current) return;
      const track = productTrackRef.current;
      const slide = track?.children[0] as HTMLElement | undefined;
      if (!track || !slide) return;
      const step = slide.offsetWidth + 12;
      if (step <= 0) return;
      const raw = Math.round(track.scrollLeft / step);
      const real = ((raw % CAROUSEL_CLONES) + CAROUSEL_CLONES) % CAROUSEL_CLONES;
      setProductActive(real);
      if (raw < CAROUSEL_CLONES || raw >= 2 * CAROUSEL_CLONES) {
        productRecentering.current = true;
        track.style.scrollSnapType = 'none';
        track.style.visibility = 'hidden';
        track.scrollTo({ left: (CAROUSEL_CLONES + real) * step, behavior: 'auto' });
        requestAnimationFrame(() => {
          track.style.scrollSnapType = '';
          track.style.visibility = '';
          requestAnimationFrame(() => {
            productRecentering.current = false;
          });
        });
      }
    });
  };

  const scrollToProduct = (index: number): void => {
    const track = productTrackRef.current;
    const slide = track?.children[0] as HTMLElement | undefined;
    if (!track || !slide || CAROUSEL_CLONES === 0) return;
    const step = slide.offsetWidth + 12;
    if (step <= 0) return;
    productRecentering.current = true;
    track.scrollTo({ left: (CAROUSEL_CLONES + index) * step, behavior: 'smooth' });
    setProductActive(index);
    window.setTimeout(() => {
      productRecentering.current = false;
    }, 420);
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
    const lines = [
      `Hello ${data.name}! Here is my enquiry from your digital card.`,
      '',
      `Name: ${leadName.trim()}`,
      leadPhone.trim().length > 0 ? `Phone: ${leadPhone.trim()}` : '',
      leadEmail.trim().length > 0 ? `Email: ${leadEmail.trim()}` : '',
      '',
      leadMessage.trim(),
    ].filter((line) => line.length > 0);
    window.open(
      `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`,
      '_blank',
      'noopener,noreferrer',
    );
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

  const validateExchange = (): FieldErrors => {
    const errors: FieldErrors = {};
    if (exName.trim().length === 0) errors.name = 'Please enter your name';
    if (exPhone.trim().length === 0) errors.phone = 'Please enter your phone';
    else if (!PHONE_RE.test(exPhone.trim())) errors.phone = 'Please enter a valid phone number';
    const email = exEmail.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address';
    // The vCard gate requires a name *and* an email; the WhatsApp flow does not.
    else if (exSavingVcf && email.length === 0) errors.email = 'Please enter your email address';
    return errors;
  };

  const handleExchangeSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (exBusy) return;
    const errors = validateExchange();
    setExErrors(errors);
    setExFormError(null);
    if (Object.keys(errors).length > 0) return;

    // Gate path: hand the collected details back to the endpoint, which logs
    // the lead and then releases the .vcf.
    if (exSavingVcf) {
      setExBusy(true);
      const result = await requestVcfDownload(vcard.urlAlias || '', {
        name: exName.trim(),
        email: exEmail.trim(),
        phone: exPhone.trim(),
      });
      setExBusy(false);
      if (result.status === 'downloaded') {
        setExSent(true);
        return;
      }
      setExFormError(
        result.status === 'gateRequired'
          ? 'Please enter your name and email address.'
          : 'Could not save the contact. Please try again.',
      );
      return;
    }

    if (!WA_NUMBER) return;
    setExBusy(true);
    const lines = [
      `Hello ${data.name}! Sharing my contact details from your digital card.`,
      '',
      `Name: ${exName.trim()}`,
      `Phone: ${exPhone.trim()}`,
      exEmail.trim().length > 0 ? `Email: ${exEmail.trim()}` : '',
    ].filter((line) => line.length > 0);
    window.open(
      `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`,
      '_blank',
      'noopener,noreferrer',
    );
    if (sheetTimer.current !== null) window.clearTimeout(sheetTimer.current);
    sheetTimer.current = window.setTimeout(() => {
      setExBusy(false);
      setExSent(true);
    }, BUSY_MS);
  };

  const sheetInput = (invalid: boolean): string =>
    `${INPUT_BASE} ${invalid ? INPUT_ERR : INPUT_OK}`;

  const galleryTotal = data.gallery.length;
  const shownServices = servicesExpanded ? data.services : data.services.slice(0, VISIBLE_SERVICES);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-100 font-sans text-zinc-900 antialiased bg-[radial-gradient(1200px_600px_at_50%_-200px,rgba(16,185,129,0.10),transparent_60%),radial-gradient(800px_500px_at_100%_100%,rgba(251,191,36,0.05),transparent_55%)]">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <main className="mx-auto w-full max-w-md flex-1 border border-black/5 bg-white/95 min-[480px]:my-6 min-[480px]:overflow-hidden min-[480px]:rounded-3xl min-[480px]:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_50px_rgba(0,0,0,0.08)]">
        {/* Cover banner */}
        <header className="relative h-48 overflow-hidden bg-zinc-200 min-[480px]:h-52">
          {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
          <img
            src={data.heroUrl}
            alt=""
            width={896}
            height={352}
            fetchPriority="high"
            className="h-full w-full object-cover ppc-shimmer"
            onError={(e) => handleImgError(e, 'media', data.name)}
          />
          <span className="pointer-events-none absolute inset-0 bg-zinc-900/10" aria-hidden="true" />
          <span
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent from-[45%] via-white/40 to-white"
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => void copyCardLink()}
            aria-label="Copy profile link"
            className="absolute right-3 top-3 z-20 grid h-11 w-11 place-items-center rounded-full border border-white/50 bg-white/70 text-zinc-900 shadow-[0_4px_14px_rgba(0,0,0,0.10)] backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-white/90 active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <FaShareNodes size={18} className="text-emerald-400" aria-hidden="true" />
          </button>
          <span
            className={`pointer-events-none absolute right-16 top-3.5 z-20 flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-3 py-1.5 text-xs font-medium text-white transition-opacity duration-200 ${
              chipVisible ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
          >
            <FaCheck size={12} className="text-emerald-400" />
            Link copied
          </span>
        </header>

        {/* Identity */}
        <div className="px-5 pb-9">
          <div className="relative z-10 -mt-14 flex flex-col items-center px-5 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
            <img
              src={data.avatarUrl}
              alt={data.name}
              width={112}
              height={112}
              data-fb-kind="avatar"
              className="h-20 w-20 rounded-2xl bg-white p-1 object-contain shadow-sm min-[360px]:h-24 min-[360px]:w-24"
              onError={(e) => handleImgError(e, 'avatar', data.name)}
            />
            <div className="mt-4 w-full min-w-0">
              <h1 className="text-xl font-bold uppercase leading-tight tracking-tight text-balance text-zinc-900 min-[400px]:text-2xl">
                {data.name}
              </h1>
              {data.tagline && (
                <p className="mt-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700 min-[400px]:text-sm">
                  {data.tagline}
                </p>
              )}
              {(data.phoneDisplay || data.phone2Display || data.email) && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {data.phoneDisplay && (
                    <a href={`tel:+${data.phoneRaw}`} className={INNER_LINK}>
                      <FaPhone size={14} aria-hidden="true" />
                      {data.phoneDisplay}
                    </a>
                  )}
                  {data.phone2Display && (
                    <a href={`tel:+${data.phone2Raw}`} className={INNER_LINK}>
                      <FaPhone size={14} aria-hidden="true" />
                      {data.phone2Display}
                    </a>
                  )}
                  {data.email && (
                    <a href={`mailto:${data.email}`} className={INNER_LINK}>
                      <FaEnvelope size={14} aria-hidden="true" />
                      {data.email}
                    </a>
                  )}
                </div>
              )}
              {data.bioHtml && (
                <div className="ppc-bio mt-3 text-sm leading-relaxed text-zinc-600 text-pretty">
                  <SafeHtml html={data.bioHtml} />
                </div>
              )}
            </div>
          </div>

          {/* Primary actions */}
          <div className="mt-4 flex justify-center gap-2.5">
            <button
              type="button"
              onClick={downloadVCard}
              className={`${MT} bg-zinc-100 px-4 py-2.5 text-xs text-zinc-900 ring-1 ring-inset ring-black/[0.04] hover:bg-white hover:shadow-md`}
            >
              <FaUserPlus size={14} aria-hidden="true" />
              Add to Contacts
            </button>
            {WA_NUMBER && (
              <button
                type="button"
                ref={exchangeBtnRef}
                onClick={() => {
                  setExSent(false);
                  setSheet('open');
                }}
                aria-expanded={sheet === 'open'}
                aria-controls="ppc-exchange-sheet"
                className={`${MT} border border-black/[0.08] bg-white px-4 py-2.5 text-xs text-zinc-900 hover:border-emerald-600/40 hover:bg-emerald-50/60 hover:text-emerald-700 hover:shadow-sm`}
              >
                <FaRightLeft size={14} aria-hidden="true" />
                Exchange Contact
              </button>
            )}
          </div>
          {data.website && (
            <a
              href={data.website}
              target="_blank"
              rel="noopener noreferrer"
              className={`${MT} mt-2.5 w-full bg-zinc-100 px-4 py-2.5 text-xs text-zinc-900 ring-1 ring-inset ring-black/[0.04] hover:bg-white hover:shadow-md`}
            >
              <FaGlobe size={14} aria-hidden="true" />
              Visit Our Website
            </a>
          )}

          {/* Social tiles */}
          {data.socials.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
              {data.socials.map((social) => (
                <a
                  key={social.url}
                  href={social.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${social.network === 'website' ? 'Website' : social.network} — ${data.name}`}
                  className={SOCIAL_TILE}
                >
                  {getBrandIcon(social.url)}
                </a>
              ))}
            </div>
          )}

          {/* Products */}
          {data.products.length > 0 && (
            <section className="mt-8" aria-labelledby="ppc-products-head">
              <SectionHeading id="ppc-products-head" icon={<FaBoxOpen size={15} />}>
                Products
              </SectionHeading>
              <div
                className="ppc-ptrack"
                ref={productTrackRef}
                onScroll={handleTrackScroll}
                tabIndex={0}
                aria-label={`Swipe between ${CAROUSEL_CLONES} product photos`}
              >
                {carouselItems.map((product, idx) => {
                  const realIndex = idx % CAROUSEL_CLONES;
                  return (
                    <article
                      key={`${product.title}-${idx}`}
                      className="ppc-pslide flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(0,0,0,0.10)]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openLightbox(
                            data.products.map((p) => p.imageUrl),
                            realIndex,
                          )
                        }
                        aria-label={`View ${product.title}`}
                        className="group relative h-36 w-full flex-none cursor-zoom-in border-0 bg-zinc-100 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          width={288}
                          height={210}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transform-none ppc-shimmer"
                          onError={(e) => handleImgError(e, 'media', data.name)}
                        />
                      </button>
                      <div className="flex min-h-0 flex-1 flex-col p-2.5">
                        <span className="mb-2 line-clamp-2 break-words text-[13px] font-semibold tracking-tight text-zinc-900">
                          {product.title}
                        </span>
                        {WA_NUMBER && (
                          <a
                            href={buildWa(WA_PRODUCT_MSG(product.title))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${WA_PILL} mt-auto min-h-11 w-full px-2 py-2 text-xs leading-tight`}
                          >
                            <FaWhatsapp size={14} aria-hidden="true" />
                            Enquire on WhatsApp
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {CAROUSEL_CLONES > 1 && (
                <div className="mt-3 flex items-center justify-center gap-1.5">
                  {data.products.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => scrollToProduct(i)}
                      aria-label={`Go to product ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i === productActive
                          ? 'w-5 bg-emerald-600'
                          : 'w-1.5 bg-zinc-300 hover:bg-zinc-400'
                      }`}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Services */}
          {data.services.length > 0 && (
            <section className="mt-8" aria-labelledby="ppc-services-head">
              <SectionHeading id="ppc-services-head" icon={<FaWrench size={15} />}>
                Services
              </SectionHeading>
              <div className="flex flex-col gap-3">
                {shownServices.map((service) => (
                  <div
                    key={service}
                    className="flex items-center gap-3 rounded-xl border border-black/5 bg-zinc-50 p-3.5 transition-colors duration-300 hover:border-black/[0.08] hover:bg-zinc-100/70"
                  >
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-emerald-100/70 text-emerald-700">
                      <ServiceIcon service={service} />
                    </span>
                    <span className="min-w-0 break-words text-sm font-semibold text-zinc-900">
                      {service}
                    </span>
                    {WA_NUMBER && (
                      <a
                        href={buildWa(WA_SERVICE_MSG(service))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${WA_PILL} ml-auto min-h-11 flex-none px-3 py-2 text-xs`}
                      >
                        <FaWhatsapp size={14} aria-hidden="true" />
                        Enquire on WhatsApp
                      </a>
                    )}
                  </div>
                ))}
              </div>
              {data.services.length > VISIBLE_SERVICES && (
                <button
                  type="button"
                  onClick={() => setServicesExpanded((flag) => !flag)}
                  aria-expanded={servicesExpanded}
                  className={`mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold text-emerald-700 transition-all duration-300 ease-out hover:bg-emerald-100/60 hover:text-emerald-800 active:scale-[0.98] motion-reduce:transform-none ${FOCUS}`}
                >
                  {servicesExpanded
                    ? 'Show less'
                    : `Show all ${data.services.length} services`}
                  <span
                    className={`transition-transform duration-200${servicesExpanded ? ' rotate-180' : ''}`}
                    aria-hidden="true"
                  >
                    <FaChevronDown size={14} />
                  </span>
                </button>
              )}
            </section>
          )}

          {/* Gallery */}
          {galleryTotal > 0 && (
            <section className="mt-8" aria-labelledby="ppc-gallery-head">
              <SectionHeading id="ppc-gallery-head" icon={<FaImages size={15} />}>
                Gallery
              </SectionHeading>
              <div className="grid grid-cols-3 gap-2">
                {data.gallery.map((photo, index) => (
                  <button
                    key={photo}
                    type="button"
                    onClick={() => openLightbox(data.gallery, index)}
                    aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                    className="group aspect-square cursor-zoom-in overflow-hidden rounded-xl border-0 bg-zinc-200 p-0 transition-shadow hover:shadow-[0_12px_28px_rgba(0,0,0,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
                    <img
                      src={photo}
                      alt={`${data.name} gallery photo ${index + 1}`}
                      width={400}
                      height={400}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105 group-hover:brightness-105 motion-reduce:transform-none ppc-shimmer"
                      onError={(e) => handleImgError(e, 'media', data.name)}
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Get in touch */}
          {WA_NUMBER && (
            <section className="mt-8" aria-labelledby="ppc-contact-head">
              <SectionHeading id="ppc-contact-head" icon={<FaEnvelope size={15} />}>
                Get in touch
              </SectionHeading>
              {leadSent ? (
                <div className="rounded-xl border border-black/5 bg-gradient-to-b from-zinc-50 to-zinc-100/80 p-6 text-center">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/20 text-emerald-700 ppc-pop">
                    <FaCheck size={24} aria-hidden="true" />
                  </span>
                  <p className="mt-3 text-[15px] font-semibold text-zinc-900">Message sent!</p>
                  <p className="mt-1 text-[13px] text-zinc-500">
                    Your enquiry has been opened in WhatsApp.
                  </p>
                  <button
                    type="button"
                    onClick={resetLead}
                    className={`mt-3 inline-flex min-h-11 items-center px-3 py-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 ${FOCUS}`}
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form className="mt-4 flex flex-col gap-3" onSubmit={handleLeadSubmit} noValidate>
                  <div>
                    <FieldLabel htmlFor="ppc-lead-name">Name</FieldLabel>
                    <input
                      id="ppc-lead-name"
                      type="text"
                      autoComplete="name"
                      placeholder="Your name"
                      value={leadName}
                      aria-invalid={leadErrors.name !== undefined}
                      aria-describedby={leadErrors.name ? 'ppc-lead-name-err' : undefined}
                      onChange={(e) => {
                        setLeadName(e.target.value);
                        setLeadErrors((prev) => ({ ...prev, name: undefined }));
                      }}
                      className={sheetInput(leadErrors.name !== undefined)}
                    />
                    {leadErrors.name && (
                      <FieldError id="ppc-lead-name-err">{leadErrors.name}</FieldError>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor="ppc-lead-email">Email</FieldLabel>
                      <input
                        id="ppc-lead-email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@email.com"
                        value={leadEmail}
                        aria-invalid={leadErrors.email !== undefined}
                        aria-describedby={leadErrors.email ? 'ppc-lead-email-err' : undefined}
                        onChange={(e) => {
                          setLeadEmail(e.target.value);
                          setLeadErrors((prev) => ({ ...prev, email: undefined }));
                        }}
                        className={sheetInput(leadErrors.email !== undefined)}
                      />
                      {leadErrors.email && (
                        <FieldError id="ppc-lead-email-err">{leadErrors.email}</FieldError>
                      )}
                    </div>
                    <div>
                      <FieldLabel htmlFor="ppc-lead-phone">Phone</FieldLabel>
                      <input
                        id="ppc-lead-phone"
                        type="tel"
                        autoComplete="tel"
                        placeholder="+91 …"
                        value={leadPhone}
                        aria-invalid={leadErrors.phone !== undefined}
                        aria-describedby={leadErrors.phone ? 'ppc-lead-phone-err' : undefined}
                        onChange={(e) => {
                          setLeadPhone(e.target.value);
                          setLeadErrors((prev) => ({ ...prev, phone: undefined }));
                        }}
                        className={sheetInput(leadErrors.phone !== undefined)}
                      />
                      {leadErrors.phone && (
                        <FieldError id="ppc-lead-phone-err">{leadErrors.phone}</FieldError>
                      )}
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor="ppc-lead-message">How can I help you?</FieldLabel>
                    <textarea
                      id="ppc-lead-message"
                      rows={3}
                      placeholder="How can I help you?"
                      value={leadMessage}
                      aria-invalid={leadErrors.message !== undefined}
                      aria-describedby={leadErrors.message ? 'ppc-lead-message-err' : undefined}
                      onChange={(e) => {
                        setLeadMessage(e.target.value);
                        setLeadErrors((prev) => ({ ...prev, message: undefined }));
                      }}
                      className={`${sheetInput(leadErrors.message !== undefined)} min-h-[76px] resize-y pt-2.5`}
                    />
                    {leadErrors.message && (
                      <FieldError id="ppc-lead-message-err">{leadErrors.message}</FieldError>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={leadBusy}
                    className={`${MT} w-full bg-emerald-700 py-3 text-sm text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-800 hover:shadow-xl`}
                  >
                    {leadBusy ? (
                      <>
                        <FaSpinner size={16} className="animate-spin" aria-hidden="true" />
                        Sending…
                      </>
                    ) : (
                      'Send Message'
                    )}
                  </button>
                </form>
              )}
            </section>
          )}

          {/* Footer */}
          <footer className="mt-8 border-t border-black/5 pt-4 text-center">
            <a
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-11 items-center py-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline ${FOCUS}`}
            >
              Powered by Taprevia
            </a>
            <a
              href="https://taprevia.com/"
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-1.5 inline-flex min-h-11 items-center py-1.5 text-[11px] text-zinc-500 hover:text-zinc-800 hover:underline ${FOCUS}`}
            >
              Click here to create your digital business card
            </a>
          </footer>
        </div>
      </main>

      {/* Reserve space under the fixed platform quick-actions dock */}
      <div aria-hidden="true" className="h-16" />

      {/* Exchange Contact — bottom sheet */}
      {sheet !== 'closed' && (
        <div
          id="ppc-exchange-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Exchange contact"
          className={`fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-[3px] transition-opacity duration-200 ease-out ${
            sheet === 'open' ? 'opacity-100 ppc-fade-in' : 'opacity-0'
          }`}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet();
          }}
        >
          <div
            className={`absolute bottom-0 left-0 right-0 mx-auto w-full max-w-md rounded-t-3xl border-t border-black/5 bg-white/95 p-5 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] shadow-[0_-20px_50px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-transform duration-300 ease-out ${
              sheet === 'open' ? 'translate-y-0' : 'translate-y-full'
            }`}
          >
            <button
              type="button"
              onClick={closeSheet}
              aria-label="Close dialog"
              className={`absolute right-3.5 top-3.5 grid h-11 w-11 place-items-center rounded-full text-zinc-500 transition-all duration-300 ease-out hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98] motion-reduce:transform-none ${FOCUS}`}
            >
              <FaXmark size={18} aria-hidden="true" />
            </button>
            <div className="flex items-start gap-3 pr-11">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-emerald-100/70 text-emerald-700">
                <FaRightLeft size={18} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-base font-bold tracking-tight text-zinc-900">
                  {exSavingVcf ? 'Save Contact' : 'Exchange Contact'}
                </h2>
                <p className="mt-0.5 text-[13px] text-zinc-500">
                  {exSavingVcf
                    ? `Enter your details to save ${data.name}'s contact.`
                    : `Share your details — ${data.name} receives them instantly on WhatsApp.`}
                </p>
              </div>
            </div>
            {exSent ? (
              <div className="mt-4 rounded-xl border border-black/5 bg-gradient-to-b from-zinc-50 to-zinc-100/80 p-6 text-center">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/20 text-emerald-700 ppc-pop">
                  <FaCheck size={24} aria-hidden="true" />
                </span>
                <p className="mt-3 text-[15px] font-semibold text-zinc-900">
                  {exSavingVcf ? 'Contact saved!' : 'Contact details sent!'}
                </p>
                <p className="mt-1 text-[13px] text-zinc-500">
                  {exSavingVcf
                    ? `${data.name}'s card is downloading — open it to add to your contacts.`
                    : `They've been shared with ${data.name} via WhatsApp.`}
                </p>
                <button
                  type="button"
                  onClick={closeSheet}
                  className={`mt-3 inline-flex min-h-11 items-center px-3 py-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 ${FOCUS}`}
                >
                  Done
                </button>
              </div>
            ) : (
              <form className="mt-4 flex flex-col gap-3" onSubmit={handleExchangeSubmit} noValidate>
                <div>
                  <FieldLabel htmlFor="ppc-ex-name">Name</FieldLabel>
                  <input
                    ref={nameInputRef}
                    id="ppc-ex-name"
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={exName}
                    aria-invalid={exErrors.name !== undefined}
                    aria-describedby={exErrors.name ? 'ppc-ex-name-err' : undefined}
                    onChange={(e) => {
                      setExName(e.target.value);
                      setExErrors((prev) => ({ ...prev, name: undefined }));
                    }}
                    className={sheetInput(exErrors.name !== undefined)}
                  />
                  {exErrors.name && <FieldError id="ppc-ex-name-err">{exErrors.name}</FieldError>}
                </div>
                <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="ppc-ex-phone">Phone</FieldLabel>
                    <input
                      id="ppc-ex-phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="+91 …"
                      value={exPhone}
                      aria-invalid={exErrors.phone !== undefined}
                      aria-describedby={exErrors.phone ? 'ppc-ex-phone-err' : undefined}
                      onChange={(e) => {
                        setExPhone(e.target.value);
                        setExErrors((prev) => ({ ...prev, phone: undefined }));
                      }}
                      className={sheetInput(exErrors.phone !== undefined)}
                    />
                    {exErrors.phone && <FieldError id="ppc-ex-phone-err">{exErrors.phone}</FieldError>}
                  </div>
                  <div>
                    <FieldLabel htmlFor="ppc-ex-email">Email</FieldLabel>
                    <input
                      id="ppc-ex-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@email.com"
                      value={exEmail}
                      aria-invalid={exErrors.email !== undefined}
                      aria-describedby={exErrors.email ? 'ppc-ex-email-err' : undefined}
                      onChange={(e) => {
                        setExEmail(e.target.value);
                        setExErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                      className={sheetInput(exErrors.email !== undefined)}
                    />
                    {exErrors.email && <FieldError id="ppc-ex-email-err">{exErrors.email}</FieldError>}
                  </div>
                </div>
                {exFormError && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700"
                  >
                    {exFormError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={exBusy}
                  className={`${MT} w-full bg-emerald-700 py-3 text-sm text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-800 hover:shadow-xl`}
                >
                  {exBusy ? (
                    <>
                      <FaSpinner size={16} className="animate-spin" aria-hidden="true" />
                      {exSavingVcf ? 'Saving…' : 'Sending…'}
                    </>
                  ) : exSavingVcf ? (
                    'Save Contact'
                  ) : (
                    'Send Contact'
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightbox !== null && (
        <div className="fixed inset-0 z-50 bg-zinc-900/70 ppc-fade-in" role="dialog" aria-modal="true" aria-label="Photo viewer">
          <div className="flex h-full w-full items-center justify-center p-5">
            <span className="absolute left-4 top-3.5 text-xs font-medium text-zinc-100 drop-shadow">
              {lightbox.index + 1} / {lightbox.photos.length}
            </span>
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close photo viewer"
              className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md transition-all duration-300 hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <FaXmark size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => stepLightbox(-1)}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md transition-all duration-300 hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <FaChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => stepLightbox(1)}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/45 text-white backdrop-blur-md transition-all duration-300 hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              <FaChevronRight size={18} aria-hidden="true" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element -- plain img per reference */}
            <img
              src={lightbox.photos[lightbox.index]}
              alt={`Photo ${lightbox.index + 1} of ${lightbox.photos.length}`}
              width={900}
              height={900}
              className="max-h-[82vh] max-w-[92vw] rounded-xl object-contain ppc-zoom-in"
            />
          </div>
        </div>
      )}
    </div>
  );
}