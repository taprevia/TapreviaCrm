'use client';

/**
 * PremiumPurpleTemplate — "Royal Aura" NFC business profile
 * (internal template key remains `premium-purple`).
 *
 * Mobile-first, presentation-only template. Every customer-facing string and
 * image comes from the live `vcard` / `products` / `reviewCta` props; nothing
 * from the visual reference is hardcoded. All business logic (VCF download,
 * encrypted contact exchange, enquiry, lead capture, sharing, gallery viewing,
 * sticky navigation) is delegated to existing, shared helpers and endpoints.
 *
 * Theme: the native signature (accent #7025BA / bg #FFFFFF) renders the full
 * navy/purple/gold design. A customer's saved custom colours override only the
 * accent/page-canvas tokens; the metallic gold decoration and the distinctive
 * double-wave geometry are fixed design elements and are never themed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, SyntheticEvent } from 'react';
import {
  ArrowLeftRight,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Crown,
  Gem,
  Gift,
  Heart,
  Images,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Phone,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  UserPlus,
  X,
} from 'lucide-react';
import { getBrandIcon } from '@/utils/getBrandIcon';
import { isSafeExternalUrl, safeExternalUrl } from '@/lib/safe-url';
import { phoneDigits, telHref } from '@/lib/phone';
import { publicBusinessHours } from '@/lib/business-hours';
import { SafeHtml } from '@/lib/sanitizer';
import { downloadVcfForCard, requestVcfDownload } from '@/lib/vcf-download';
import { resolveCustomerPublicUrl } from '@/lib/services/customer-public-url';
import { canonicalPublicBase } from '@/lib/public-base';
import {
  GALLERY_PREVIEW_COUNT,
  galleryPreview,
  useGalleryViewer,
  type GalleryImage,
} from '@/lib/hooks/use-gallery-viewer';
import { BrandIcon } from '../socials-row';
import type { IProduct, IVcard, ReviewCta } from '../types';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VISIBLE_COUNT = 3;

/**
 * One shared wave geometry drives the clipped cover boundary and the metallic
 * gold outline. Unit coordinates map to the cover box, so the same path scales
 * with any viewport width and the two layers cannot drift apart.
 */
const COVER_WAVE_EDGE =
  'M0 .70 C .085 .80, .195 .98, .305 .92 C .39 .86, .42 .70, .515 .73 C .615 .76, .625 .96, .74 .95 C .845 .94, .895 .74, 1 .72';
const COVER_WAVE_BODY = `${COVER_WAVE_EDGE} L1 0 L0 0 Z`;

/**
 * Scoped theme tokens. Values come only from pre-validated #RRGGBB CSS vars
 * supplied by the public page / builder preview — no raw client CSS is
 * injected. The gold palette and wave geometry are fixed by design.
 */
const STYLES = `
.pp-root{--pp-accent:#7025BA;--pp-accent-2:#9635DB;--pp-page:#ffffff;--pp-gold:#d9a441;--pp-gold-light:#ffe3a3;--pp-navy:#070b2e;--pp-navy-2:#101a48;--pp-purple:#3d0f7a;--pp-magenta:#8b2fd6;--pp-lav:#f2edff;--pp-ink:#131835;}
.pp-root.pp-custom-accent{--pp-accent:var(--v-accent,#7025BA);}
.pp-root.pp-custom-bg{--pp-page:var(--v-bg,#ffffff);}
.pp-root{background:var(--pp-page);color:var(--pp-ink);}
.pp-grad{background-image:linear-gradient(135deg,var(--pp-accent),var(--pp-accent-2));}
.pp-wave-gold{stroke:var(--pp-gold);}
.pp-wave-gold-light{stroke:var(--pp-gold-light);}
.pp-ring{background:linear-gradient(135deg,var(--pp-gold-light),var(--pp-gold));}
.pp-focus:focus-visible{outline:2px solid var(--pp-accent);outline-offset:2px;}
.pp-shimmer{background-color:#f6f2ff;background-image:linear-gradient(135deg,#fbf9ff,#ede4ff);}
.pp-root .text-pp-ink{color:var(--pp-ink);}
.pp-root .bg-pp-lav{background-color:var(--pp-lav);}
.pp-root .bg-pp-navy{background-color:var(--pp-navy);}
.pp-photo-shadow{box-shadow:0 14px 34px rgba(3,6,30,.55);}
.pp-actions{display:grid;grid-template-columns:1fr;gap:.5rem;}
/* Action labels stay on one line when the row has room to hold all three. */
@media(min-width:360px) and (max-width:439px){
  .pp-actions{grid-template-columns:repeat(2,minmax(0,1fr));}
  .pp-actions > :nth-child(3){grid-column:1/-1;}
}
@media(min-width:440px){
  .pp-actions{grid-template-columns:repeat(3,minmax(0,1fr));}
  .pp-root .pp-action-btn{white-space:nowrap;}
}
.pp-products-row{display:flex;gap:.6rem;overflow-x:auto;position:relative;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scroll-behavior:smooth;}
.pp-products-row::-webkit-scrollbar{display:none;}
.pp-products-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;}
.pp-product-card{flex:0 0 64%;max-width:170px;min-width:132px;scroll-snap-align:start;}
@media(min-width:420px){.pp-product-card{flex:0 0 calc((100% - 1.2rem)/3);max-width:none;min-width:0;}}
/* Height guide matches the product image area (4:3) so edge arrows center on it. */
.pp-carousel-guide{position:absolute;top:0;left:0;right:0;height:0;padding-bottom:clamp(99px,48%,127.5px);pointer-events:none;z-index:20;}
@media(min-width:420px){.pp-carousel-guide{padding-bottom:calc(25% - .3rem);}}
.pp-services-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;}
/* Exactly three displayed services stay on one row at every width. */
.pp-services-grid-three{grid-template-columns:repeat(3,minmax(0,1fr));}
@media(max-width:419px){.pp-services-grid-three{gap:.4rem;}}
@media(max-width:359px){.pp-services-grid-three{gap:.3rem;}.pp-services-grid-three > *{padding-left:.4rem;padding-right:.4rem;}}
.pp-gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;}
.pp-form-grid{display:grid;grid-template-columns:1fr;gap:.7rem;}
.pp-span-all{grid-column:1/-1;}
.pp-scroll::-webkit-scrollbar{height:4px;}
.pp-scroll::-webkit-scrollbar-thumb{background:#d8c7f5;border-radius:999px;}
@media(min-width:420px){
  .pp-services-grid{grid-template-columns:repeat(3,minmax(0,1fr));}
  .pp-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media(min-width:640px){.pp-gallery-grid{grid-template-columns:repeat(4,minmax(0,1fr));}}
@media (prefers-reduced-motion:reduce){.pp-root *{scroll-behavior:auto!important;}}
`;

const SERVICE_ICONS = [Gem, Crown, Sparkles, Gift, Heart, ShieldCheck, Package, Star];

interface Notice {
  kind: 'error' | 'success';
  text: string;
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

function fallbackImage(label: string): string {
  const safe = label.toUpperCase().replace(/[<>&'"]/g, '').slice(0, 40);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360'>` +
      `<rect width='480' height='360' fill='#f6f2ff'/>` +
      `<rect x='12' y='12' width='456' height='336' rx='20' fill='none' stroke='#d9a441' stroke-opacity='.55' stroke-width='2'/>` +
      `<g transform='translate(240 148)' fill='none' stroke='#8b2fd6' stroke-opacity='.7' stroke-width='5' stroke-linejoin='round'>` +
      `<path d='M-34 -14 L0 -32 L34 -14 L34 22 L0 40 L-34 22 Z'/><path d='M-34 -14 L0 4 L34 -14 M0 4 L0 40'/></g>` +
      `<text x='240' y='268' text-anchor='middle' font-family='Arial,sans-serif' font-weight='bold' letter-spacing='2' font-size='22' fill='#3d0f7a'>${safe}</text></svg>`,
  )}`;
}

/** Presentational platform tint for social tiles — never a data or URL change. */
function socialIconColor(url: string): string {
  const palette: Array<[string, string]> = [
    ['instagram', '#E1306C'],
    ['linkedin', '#0A66C2'],
    ['twitter', '#111827'],
    ['x.com', '#111827'],
    ['facebook', '#1877F2'],
    ['youtube', '#FF0033'],
    ['whatsapp', '#25D366'],
    ['wa.me', '#25D366'],
    ['tiktok', '#111827'],
    ['github', '#24292F'],
    ['pinterest', '#E60023'],
    ['telegram', '#229ED9'],
    ['spotify', '#1DB954'],
    ['snapchat', '#FFFC00'],
  ];
  const lower = url.toLowerCase();
  const match = palette.find(([host]) => lower.includes(host));
  return match ? match[1] : 'var(--pp-accent)';
}

const onImgError = (event: SyntheticEvent<HTMLImageElement>, label: string): void => {
  const img = event.currentTarget;
  if (img.dataset.ppfb === '1') return;
  img.dataset.ppfb = '1';
  img.src = fallbackImage(label);
};

/**
 * Mirror the repository media policy for customer-supplied cover sources:
 * absolute http(s) URLs or a genuine site-relative path. Rejects javascript:,
 * data:, protocol-relative and other unexpected schemes.
 */
function isSafeCoverMediaUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  if (value.startsWith('/')) return !/^\/[\\/]/.test(value);
  return isSafeExternalUrl(value);
}

function SectionHeading({
  icon,
  children,
  action,
  id,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="pp-ring pp-focus grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white shadow-sm">
        {icon}
      </span>
      <h2 id={id} className="text-base font-bold tracking-tight text-pp-ink">
        {children}
      </h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export function PremiumPurpleTemplate({
  vcard,
  products,
  reviewCta,
}: {
  vcard: IVcard;
  products: IProduct[];
  reviewCta?: ReviewCta;
}) {
  // ── Derived data (all from existing editable fields) ─────────────────────
  const name =
    vcard.name?.trim() ||
    [vcard.basic?.firstName?.trim(), vcard.basic?.lastName?.trim()]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    'Profile';
  const designation =
    vcard.occupation?.trim() || vcard.basic?.jobTitle?.trim() || vcard.basic?.company?.trim() || '';
  const bio = vcard.descriptionHtml?.trim() || '';
  const primaryPhone = vcard.basic?.phone?.trim() || '';
  const alternatePhone = vcard.basic?.alternatePhone?.trim() || '';
  const email = vcard.basic?.email?.trim() || '';
  const avatarUrl = vcard.profileImageUrl?.trim() || '';
  // DTO exposes coverImageUrl plus coverValue. Prefer the first safe candidate
  // without changing stored data or shared contracts.
  const coverImageCandidates = [
    (vcard as IVcard & { coverImageUrl?: string }).coverImageUrl?.trim() ?? '',
    vcard.coverValue?.trim() ?? '',
  ];
  const coverImage =
    vcard.coverType !== 'color' ? coverImageCandidates.find(isSafeCoverMediaUrl) ?? '' : '';

  const phoneLinks = useMemo(
    () =>
      [
        primaryPhone ? { label: 'Call', href: telHref(primaryPhone), value: primaryPhone, icon: Phone } : null,
        alternatePhone ? { label: 'Alt', href: telHref(alternatePhone), value: alternatePhone, icon: Phone } : null,
        email ? { label: 'Email', href: `mailto:${email.replace(/[\r\n<>"]/g, '')}`, value: email, icon: Mail } : null,
      ].filter((row): row is { label: string; href: string | null; value: string; icon: typeof Phone } => row !== null),
    [primaryPhone, alternatePhone, email],
  );

  const socialLinks = useMemo(
    () =>
      (vcard.socialLinks ?? [])
        .map((link) => ({ url: safeExternalUrl(link.url), label: link.label?.trim() || link.platform?.trim() || 'Visit' }))
        .filter((link) => link.url.length > 0),
    [vcard.socialLinks],
  );

  const activeProducts = useMemo(
    () => (products ?? []).filter((p) => p.active !== false),
    [products],
  );

  const services = useMemo(
    () => (vcard.services ?? []).map((s) => s.title?.trim()).filter((title): title is string => Boolean(title)),
    [vcard.services],
  );

  const galleryImages = useMemo<GalleryImage[]>(
    () =>
      (vcard.galleryImages ?? [])
        .map((g) => ({
          url: g?.imageUrl?.trim() ?? '',
          caption: typeof g?.caption === 'string' ? g.caption.trim() : '',
        }))
        .filter((row) => row.url.length > 0),
    [vcard.galleryImages],
  );
  const gallery = useGalleryViewer();
  const galleryPreviewRows = galleryPreview(galleryImages, GALLERY_PREVIEW_COUNT);
  // The first captioned preview row keeps its caption attached to its own tile.
  const firstCaptionedPreviewIndex = galleryPreviewRows.findIndex((row) => Boolean(row.caption));
  const galleryTotal = galleryImages.length;
  const galleryExtra = Math.max(0, galleryTotal - GALLERY_PREVIEW_COUNT);

  const hours = useMemo(
    () => publicBusinessHours(vcard.businessHours, vcard.businessHoursFormat),
    [vcard.businessHours, vcard.businessHoursFormat],
  );

  // ── Theme signature ─────────────────────────────────────────────────────
  const accentHex = (vcard.themeConfig?.accentColor ?? '').trim().toUpperCase();
  const bgHex = (vcard.themeConfig?.bgColor ?? '').trim().toUpperCase();
  const isNativeTheme = accentHex === '#7025BA' && bgHex === '#FFFFFF';
  const themedAccent = !isNativeTheme && HEX_COLOR_RE.test(vcard.themeConfig?.accentColor ?? '');
  const themedBg = !isNativeTheme && HEX_COLOR_RE.test(vcard.themeConfig?.bgColor ?? '');

  // ── Local UI state ───────────────────────────────────────────────────────
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const displayedServices = servicesExpanded ? services : services.slice(0, VISIBLE_COUNT);
  const [modal, setModal] = useState<'closed' | 'vcf' | 'exchange'>('closed');
  const [modalName, setModalName] = useState('');
  const [modalEmail, setModalEmail] = useState('');
  const [modalPhone, setModalPhone] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadMessage, setLeadMessage] = useState('');
  const [leadBusy, setLeadBusy] = useState(false);

  // ── Finite product carousel (scroll-snap track + bounded controls) ───────
  const productTrackRef = useRef<HTMLDivElement | null>(null);
  const productScrollRaf = useRef<number | null>(null);
  const [productNav, setProductNav] = useState({ atStart: true, atEnd: true, scrollable: false });

  const measureProductNav = useCallback(() => {
    const track = productTrackRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const next = {
      atStart: track.scrollLeft <= 1,
      atEnd: track.scrollLeft >= maxScroll - 1,
      scrollable: maxScroll > 1,
    };
    setProductNav((prev) =>
      prev.atStart === next.atStart && prev.atEnd === next.atEnd && prev.scrollable === next.scrollable
        ? prev
        : next,
    );
  }, []);

  useEffect(() => {
    const track = productTrackRef.current;
    if (!track) return;
    measureProductNav();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureProductNav);
    observer.observe(track);
    const firstCard = track.firstElementChild;
    if (firstCard) observer.observe(firstCard);
    return () => observer.disconnect();
  }, [activeProducts.length, productsExpanded, measureProductNav]);

  useEffect(
    () => () => {
      if (productScrollRaf.current !== null) window.cancelAnimationFrame(productScrollRaf.current);
    },
    [],
  );

  const handleProductScroll = (): void => {
    if (productScrollRaf.current !== null) return;
    productScrollRaf.current = window.requestAnimationFrame(() => {
      productScrollRaf.current = null;
      measureProductNav();
    });
  };

  const scrollProducts = (direction: -1 | 1): void => {
    const track = productTrackRef.current;
    const firstCard = track?.firstElementChild as HTMLElement | undefined;
    if (!track || !firstCard) return;
    const gap = parseFloat(window.getComputedStyle(track).columnGap || '0') || 0;
    const step = firstCard.getBoundingClientRect().width + gap;
    if (step <= 0) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const target = Math.min(maxScroll, Math.max(0, track.scrollLeft + direction * step));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: target, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  // Share sheet lifecycle: Esc to close, scroll lock — same as StickyDock.
  useEffect(() => {
    if (!shareSheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShareSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [shareSheetOpen]);

  const waDigits = phoneDigits(primaryPhone);
  const waLink = (message: string): string | null =>
    waDigits.length >= 8
      ? `https://wa.me/${waDigits}?text=${encodeURIComponent(message)}`
      : null;

  // ── Shared actions ───────────────────────────────────────────────────────
  const addToContact = async () => {
    setNotice(null);
    const result = await downloadVcfForCard(vcard);
    if (result.status === 'gateRequired') {
      setModalName('');
      setModalEmail('');
      setModalPhone('');
      setModal('vcf');
      return;
    }
    if (result.status === 'error') setNotice({ kind: 'error', text: 'Could not save the contact. Please try again.' });
  };

  const shareUrl = resolveCustomerPublicUrl(vcard, canonicalPublicBase()) ?? '';
  const shareText = `Check out ${name}'s digital card`;

  const handleShare = () => {
    // Track FIRST, unconditionally — identical to StickyDock: one event/click.
    void fetch('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ alias: vcard.urlAlias, action: 'share' }),
    }).catch(() => {});
    if (!shareUrl) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({ title: name, text: shareText, url: shareUrl })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setCopied(false);
          setShareSheetOpen(true);
        });
      return;
    }
    setCopied(false);
    setShareSheetOpen(true);
  };

  const handleCopyLink = () => {
    navigator.clipboard
      ?.writeText(shareUrl)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  const submitModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const person = modalName.trim();
    const mail = modalEmail.trim();
    const phone = modalPhone.trim();
    if (!person) return;
    if (modal === 'vcf' && !EMAIL_RE.test(mail)) return;
    if (modal === 'exchange' && (!phone || (mail && !EMAIL_RE.test(mail)))) return;
    setModalBusy(true);
    setNotice(null);

    if (modal === 'vcf') {
      // Gate path: the endpoint logs the lead and releases the canonical .vcf.
      const result = await requestVcfDownload(vcard.urlAlias || '', {
        name: person,
        email: mail,
        ...(phone ? { phone } : {}),
      });
      if (result.status === 'downloaded') {
        setModal('closed');
        setNotice({ kind: 'success', text: 'Contact saved.' });
      } else {
        setNotice({ kind: 'error', text: 'Could not save the contact. Please try again.' });
      }
      setModalBusy(false);
      return;
    }

    // Exchange: the same validated delivery pattern used by the existing
    // templates — wa.me for cards with WhatsApp, else the gated VCF/lead API.
    const lines = [
      `Hello ${name}! Sharing my contact details from your digital card.`,
      '',
      `Name: ${person}`,
      `Phone: ${phone}`,
      ...(mail ? [`Email: ${mail}`] : []),
    ];
    const wa = waLink(lines.join('\n'));
    if (wa) {
      window.open(wa, '_blank', 'noopener,noreferrer');
      setModal('closed');
      setNotice({ kind: 'success', text: 'Details sent. Thank you!' });
      setModalBusy(false);
      return;
    }
    const result = await requestVcfDownload(vcard.urlAlias || '', { name: person, email: mail, phone });
    if (result.status === 'downloaded') {
      setModal('closed');
      setNotice({ kind: 'success', text: 'Details shared. Thank you!' });
    } else if (result.status === 'gateRequired') {
      setNotice({ kind: 'error', text: 'Please enter a valid email address.' });
    } else {
      setNotice({ kind: 'error', text: 'Could not share your details. Please try again.' });
    }
    setModalBusy(false);
  };

  const submitLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const person = leadName.trim();
    if (!person || leadBusy) return;
    setLeadBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/public/cards/${encodeURIComponent(vcard.urlAlias || '')}/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: person,
          email: leadEmail.trim(),
          phone: leadPhone.trim(),
          message: leadMessage.trim(),
          source: 'contact_form',
        }),
      });
      if (!res.ok) throw new Error('request failed');
      setLeadName('');
      setLeadEmail('');
      setLeadPhone('');
      setLeadMessage('');
      setNotice({ kind: 'success', text: 'Message sent. We will be in touch!' });
    } catch {
      setNotice({ kind: 'error', text: 'Could not send your message. Please try again.' });
    }
    setLeadBusy(false);
  };

  const inputClass =
    'pp-focus h-11 w-full rounded-lg border border-violet-100/80 bg-white px-3 text-base text-pp-ink placeholder:text-violet-300/80 shadow-sm';
  const rootStyle = {
    '--pp-accent': themedAccent ? 'var(--v-accent, #7025BA)' : '#7025BA',
    '--pp-page': themedBg ? 'var(--v-bg, #ffffff)' : '#ffffff',
  } as CSSProperties;

  return (
    <div
      className={`pp-root relative mx-auto w-full overflow-hidden pb-28 font-sans shadow-xl${themedAccent ? ' pp-custom-accent' : ''}${themedBg ? ' pp-custom-bg' : ''}`}
      style={rootStyle}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ── Cover ─────────────────────────────────────────────────────────── */}
      {/* Keep the original cover box height now that the branding overlay is gone. */}
      <header className="relative overflow-hidden" style={{ minHeight: 204, paddingBottom: 96 }}>
        {/* Shared geometry: CSS clip for HTML layers, SVG clip for decorative shapes. */}
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <defs>
            <clipPath id="pp-cover-html-clip" clipPathUnits="objectBoundingBox">
              <path d={COVER_WAVE_BODY} />
            </clipPath>
            <clipPath id="pp-cover-svg-clip" clipPathUnits="userSpaceOnUse">
              <path d={COVER_WAVE_BODY} />
            </clipPath>
          </defs>
        </svg>

        {/* the cover itself ends on the wave — page white shows below it */}
        <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pp-diag" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffe3a3" stopOpacity=".24" />
              <stop offset="1" stopColor="#8b2fd6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={COVER_WAVE_BODY} fill="#070b2e" />
          <g clipPath="url(#pp-cover-svg-clip)">
            <path d="M-.1 0 L.3 0 L-.1 .82 Z" fill="url(#pp-diag)" />
            <path d="M1.1 0 L.7 0 L1.1 .86 Z" fill="url(#pp-diag)" opacity=".8" />
            <path d="M-.05 .27 L.45 -.14 M-.05 .43 L.53 -.05 M1.03 .32 L.58 -.09 M1.03 .5 L.65 .05" stroke="var(--pp-gold-light)" strokeOpacity=".16" strokeWidth=".8" vectorEffect="non-scaling-stroke" fill="none" />
          </g>
        </svg>

        {/* existing customer cover image, clipped to the same wave */}
        {coverImage ? (
          <div aria-hidden="true" className="absolute inset-0" style={{ clipPath: 'url(#pp-cover-html-clip)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- customer cover image */}
            <img
              src={coverImage}
              alt=""
              onError={(e) => onImgError(e, name)}
              className="h-full w-full object-cover opacity-[0.82]"
            />
          </div>
        ) : null}

        {/* deep navy centre with royal purple / magenta illumination at the edges */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            clipPath: 'url(#pp-cover-html-clip)',
            // Keep the original gradient at full strength when no safe cover
            // image exists; soften it into a contrast scrim when one does.
            opacity: coverImage ? 0.55 : 1,
            background:
              'radial-gradient(95% 85% at 0% 6%, rgba(139,47,214,.88) 0%, transparent 58%),' +
              'radial-gradient(95% 85% at 100% 6%, rgba(61,15,122,.92) 0%, transparent 58%),' +
              'radial-gradient(70% 80% at 50% 46%, rgba(7,11,46,.18) 0%, rgba(7,11,46,.78) 100%),' +
              'linear-gradient(155deg, rgba(150,53,219,.42), transparent 42%, rgba(139,47,214,.3))',
          }}
        />

        {/* share button */}
        <button
          type="button"
          onClick={handleShare}
          aria-label={`Share ${name}'s card`}
          className="pp-focus absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-white/85 text-pp-navy shadow-md backdrop-blur transition hover:bg-white"
        >
          <Share2 size={16} aria-hidden="true" />
        </button>

        {/* metallic gold band on the exact same boundary as the clipped cover */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pp-gold-band" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#b8862f" />
              <stop offset=".45" stopColor="#ffe3a3" />
              <stop offset="1" stopColor="#c99736" />
            </linearGradient>
          </defs>
          <path d={COVER_WAVE_EDGE} fill="none" stroke="url(#pp-gold-band)" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={COVER_WAVE_EDGE} transform="translate(0 .018)" fill="none" stroke="var(--pp-gold-light)" strokeWidth="1.5" strokeOpacity=".9" vectorEffect="non-scaling-stroke" />
        </svg>
      </header>

      {/* ── Profile identity ──────────────────────────────────────────────── */}
      <section className="relative z-10 -mt-12 px-5 text-center">
        <div className="relative mx-auto w-fit">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote/S3 avatar; sanitized upstream
            <img
              src={avatarUrl}
              alt={name}
              width={96}
              height={96}
              onError={(e) => onImgError(e, name)}
              className="pp-ring pp-photo-shadow mx-auto h-24 w-24 rounded-full border-[3px] border-white object-cover p-[3px]"
            />
          ) : (
            <div className="pp-ring pp-photo-shadow mx-auto grid h-24 w-24 place-items-center rounded-full border-[3px] border-white p-[3px] text-2xl font-bold text-white shadow-lg">
              <span className="grid h-full w-full place-items-center rounded-full bg-pp-purple" style={{ backgroundColor: 'var(--pp-purple)' }}>
                {initialsFor(name)}
              </span>
            </div>
          )}
          {/* purely decorative gold motif — not a verification badge */}
          <span aria-hidden="true" className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-gradient-to-br from-[#ffe3a3] to-[#d9a441] shadow-md">
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M6 0.8 7.5 4.5 11.2 6 7.5 7.5 6 11.2 4.5 7.5 0.8 6 4.5 4.5Z" fill="#3d0f7a" fillOpacity=".72" />
            </svg>
          </span>
        </div>
        <h1 className="mt-3 break-words text-xl font-extrabold tracking-tight text-pp-ink sm:text-2xl">{name}</h1>
        {designation ? (
          <span className="mt-2 inline-block rounded-full bg-pp-lav px-3 py-1 text-xs font-semibold" style={{ color: 'var(--pp-accent)', backgroundColor: 'var(--pp-lav)' }}>
            {designation}
          </span>
        ) : null}
        {bio ? (
          <div className="mx-auto mt-2.5 max-w-md text-[13px] leading-relaxed text-slate-600">
            <SafeHtml html={bio} />
          </div>
        ) : null}

        {/* contact rows */}
        {phoneLinks.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5">
            {phoneLinks.map((row, index) => (
              <div key={`${row.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true" className="h-3.5 w-px bg-violet-200" /> : null}
                {row.href ? (
                  <a href={row.href} className="pp-focus inline-flex items-center gap-1.5 text-[12px] font-medium text-pp-ink hover:opacity-70">
                    <row.icon size={14} style={{ color: 'var(--pp-accent)' }} aria-hidden="true" />
                    <span className="max-w-[150px] truncate">{row.value}</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-pp-ink">
                    <row.icon size={14} style={{ color: 'var(--pp-accent)' }} aria-hidden="true" />
                    <span className="max-w-[150px] truncate">{row.value}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Primary actions — balanced compact row, responsive fallback ──── */}
      <section className="pp-actions mt-5 px-5" aria-label="Quick actions">
        <button type="button" onClick={addToContact} className="pp-grad pp-action-btn pp-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold leading-tight text-white shadow-md transition active:scale-[0.99]">
          <UserPlus size={14} aria-hidden="true" /> Add to Contacts
        </button>
        <button
          type="button"
          onClick={() => { setNotice(null); setModalName(''); setModalEmail(''); setModalPhone(''); setModal('exchange'); }}
          className="pp-action-btn pp-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl bg-pp-lav px-1 text-center text-[10px] font-bold leading-tight shadow-sm transition active:scale-[0.99]"
          style={{ color: 'var(--pp-accent)', backgroundColor: 'var(--pp-lav)' }}
        >
          <ArrowLeftRight size={14} aria-hidden="true" /> Exchange Contact
        </button>
        {reviewCta ? (
          <a href={reviewCta.href} aria-label={`Rate ${name} on Google`} className="pp-action-btn pp-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl bg-pp-lav px-1 text-center text-[10px] font-bold leading-tight shadow-sm transition active:scale-[0.99]" style={{ color: 'var(--pp-accent)', backgroundColor: 'var(--pp-lav)' }}>
            <Star size={14} aria-hidden="true" /> Rate us on Google
          </a>
        ) : null}
      </section>

      {/* ── Social links ──────────────────────────────────────────────────── */}
      {socialLinks.length > 0 ? (
        <section className="mt-6 px-5" aria-label="Social links">
          <div className="flex flex-wrap justify-center gap-2.5">
            {socialLinks.map((link, index) => (
              <a
                key={`${link.url}-${index}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                title={link.label}
                className="pp-focus grid h-10 w-10 place-items-center rounded-xl bg-white text-base shadow-sm ring-1 ring-violet-100 transition hover:-translate-y-0.5 hover:shadow-md"
                style={{ color: socialIconColor(link.url) }}
              >
                {getBrandIcon(link.url)}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Products ──────────────────────────────────────────────────────── */}
      {activeProducts.length > 0 ? (
        <section className="mt-7 px-5" aria-labelledby="pp-products-head">
          <SectionHeading
            id="pp-products-head"
            icon={<Box size={16} />}
            action={
              activeProducts.length > VISIBLE_COUNT ? (
                <button type="button" onClick={() => setProductsExpanded((v) => !v)} className="pp-focus text-xs font-bold" style={{ color: 'var(--pp-accent)' }}>
                  {productsExpanded ? 'Show Less' : 'See All Products'}
                </button>
              ) : null
            }
          >
            Products
          </SectionHeading>
          <div className="relative">
            <div
              id="pp-products-track"
              role="region"
              ref={productTrackRef}
              onScroll={handleProductScroll}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  scrollProducts(1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  scrollProducts(-1);
                }
              }}
              tabIndex={0}
              aria-label="Product carousel"
              className={productsExpanded ? 'pp-products-grid' : 'pp-products-row pp-scroll pb-2'}
            >
              {activeProducts.map((product, index) => {
                const enquiry = waLink(`Hello ${name}! I'd like to enquire about your "${product.title}" product.`);
                return (
                  <article key={product._id || index} className={productsExpanded ? 'min-w-0' : 'pp-product-card'}>
                    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-violet-100/70">
                      {/* eslint-disable-next-line @next/next/no-img-element -- customer catalogue image */}
                      <img
                        src={product.imageUrl || fallbackImage(product.title)}
                        alt={product.title}
                        width={300}
                        height={240}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => onImgError(e, product.title)}
                        className="pp-shimmer aspect-[4/3] w-full object-cover"
                      />
                      <div className="p-2">
                        <h3 className="line-clamp-2 text-[11px] font-bold leading-tight text-pp-ink">{product.title}</h3>
                        {enquiry ? (
                          <a href={enquiry} target="_blank" rel="noopener noreferrer" className="pp-focus mt-2 flex min-h-[32px] items-center justify-center gap-1 rounded-lg bg-[#1DCC4A] px-1.5 text-[10px] font-bold text-white transition hover:brightness-105">
                            <MessageCircle size={12} aria-hidden="true" /> Enquire
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {!productsExpanded && productNav.scrollable ? (
              <div className="pp-carousel-guide">
                <button
                  type="button"
                  onClick={() => scrollProducts(-1)}
                  disabled={productNav.atStart}
                  aria-label="Previous products"
                  aria-controls="pp-products-track"
                  className="pp-focus pointer-events-auto absolute left-0 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/90 shadow-md backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: 'var(--pp-accent)' }}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollProducts(1)}
                  disabled={productNav.atEnd}
                  aria-label="Next products"
                  aria-controls="pp-products-track"
                  className="pp-focus pointer-events-auto absolute right-0 top-1/2 grid h-10 w-10 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/90 shadow-md backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: 'var(--pp-accent)' }}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Services ──────────────────────────────────────────────────────── */}
      {services.length > 0 ? (
        <section className="mt-7 px-5" aria-labelledby="pp-services-head">
          <div className="rounded-2xl px-3.5 py-4 shadow-sm ring-1 ring-violet-100/60" style={{ backgroundColor: 'var(--pp-lav)' }}>
            <SectionHeading
              id="pp-services-head"
              icon={<Crown size={16} />}
              action={
                services.length > VISIBLE_COUNT ? (
                  <button type="button" onClick={() => setServicesExpanded((v) => !v)} className="pp-focus text-xs font-bold" style={{ color: 'var(--pp-accent)' }}>
                    {servicesExpanded ? 'Show Less' : 'See All Services'}
                  </button>
                ) : null
              }
            >
              Services
            </SectionHeading>
            <div className={`pp-services-grid${displayedServices.length === VISIBLE_COUNT ? ' pp-services-grid-three' : ''}`}>
              {displayedServices.map((service, index) => {
                const Icon = SERVICE_ICONS[index % SERVICE_ICONS.length] ?? Sparkles;
                const enquiry = waLink(`Hello ${name}! I'm interested in ${service}. Please share details.`);
                return (
                  <div key={`${service}-${index}`} className="min-w-0 rounded-xl bg-white/90 px-2 py-3 text-center shadow-sm ring-1 ring-violet-50">
                    <span className="pp-focus mx-auto mb-1.5 grid h-8 w-8 place-items-center rounded-lg" style={{ color: 'var(--pp-accent)', backgroundColor: 'var(--pp-lav)' }}>
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <p className="line-clamp-2 break-words text-[11px] font-bold leading-tight text-pp-ink">{service}</p>
                    {enquiry ? (
                      <a href={enquiry} target="_blank" rel="noopener noreferrer" aria-label={`Enquire about ${service}`} className="pp-focus mt-1.5 inline-flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--pp-accent)' }}>
                        Enquire
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Gallery ───────────────────────────────────────────────────────── */}
      {galleryTotal > 0 ? (
        <section className="mt-7 px-5" aria-labelledby="pp-gallery-head">
          <SectionHeading
            id="pp-gallery-head"
            icon={<Images size={16} />}
            action={
              <button type="button" onClick={() => gallery.openGrid(galleryImages)} className="pp-focus text-xs font-bold" style={{ color: 'var(--pp-accent)' }}>
                View All {galleryTotal} Photos
              </button>
            }
          >
            Gallery
          </SectionHeading>
          <div className="pp-gallery-grid">
            {galleryPreviewRows.map((row, index) => (
              <button
                key={`${row.url}-${index}`}
                type="button"
                onClick={() => gallery.openPreviewImage(galleryImages, index)}
                aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                className="pp-focus relative aspect-square overflow-hidden rounded-lg shadow-sm ring-1 ring-violet-100/70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" decoding="async" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                {index === GALLERY_PREVIEW_COUNT - 1 && galleryExtra > 0 ? (
                  <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-[#0b0a2a]/85 via-[#0b0a2a]/55 to-transparent text-[11px] font-bold text-white">
                    +{galleryExtra} More
                  </span>
                ) : null}
                {index === firstCaptionedPreviewIndex && row.caption ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-[#0b0a2a]/90 to-transparent px-1.5 pb-1 pt-3 text-left text-[9px] font-medium text-white">
                    {row.caption}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Business hours ────────────────────────────────────────────────── */}
      {hours.length > 0 ? (
        <section className="mt-7 px-5" aria-labelledby="pp-hours-head">
          <SectionHeading id="pp-hours-head" icon={<Clock3 size={16} />}>Business Hours</SectionHeading>
          <div className="space-y-1.5 rounded-2xl bg-white p-4 shadow-sm">
            {hours.map((row) => (
              <div key={row.day} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-pp-ink">{row.label}</span>
                <span className={row.closed ? 'italic text-slate-400' : 'tabular-nums text-slate-600'}>{row.time}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Get in touch ──────────────────────────────────────────────────── */}
      <section className="mt-7 px-5" aria-labelledby="pp-contact-head">
        <div className="rounded-2xl border border-violet-100 p-4 shadow-[0_10px_30px_rgba(49,16,101,.06)]" style={{ backgroundColor: 'var(--pp-lav)' }}>
          <SectionHeading id="pp-contact-head" icon={<Send size={16} />}>Get in touch</SectionHeading>
          <form onSubmit={submitLead} className="pp-form-grid" noValidate>
            <div><label htmlFor="pp-lead-name" className="sr-only">Name</label><input id="pp-lead-name" className={inputClass} placeholder="Your name" autoComplete="name" maxLength={100} value={leadName} onChange={(e) => setLeadName(e.target.value)} required /></div>
            <div><label htmlFor="pp-lead-email" className="sr-only">Email</label><input id="pp-lead-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} /></div>
            <div className="pp-span-all"><label htmlFor="pp-lead-phone" className="sr-only">Phone</label><input id="pp-lead-phone" type="tel" className={inputClass} placeholder="Phone number" autoComplete="tel" maxLength={20} value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} /></div>
            <div className="pp-span-all"><label htmlFor="pp-lead-message" className="sr-only">Message</label><textarea id="pp-lead-message" className={`${inputClass} h-24 resize-none py-2.5`} placeholder="Your message" maxLength={2000} value={leadMessage} onChange={(e) => setLeadMessage(e.target.value)} /></div>
            <button type="submit" disabled={leadBusy} className="pp-grad pp-focus pp-span-all flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-white shadow-md transition disabled:opacity-60">
              <Send size={16} aria-hidden="true" /> {leadBusy ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        </div>
      </section>

      {/* ── Notices ───────────────────────────────────────────────────────── */}
      {notice ? (
        <div role="status" className={`mx-5 mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${notice.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {notice.kind === 'success' ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
          {notice.text}
        </div>
      ) : null}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="mt-7 px-5 pb-1 pt-5 text-center">
        <span aria-hidden="true" className="mx-auto mb-2 block h-px w-12 bg-gradient-to-r from-transparent via-[var(--pp-gold)] to-transparent" />
        <p className="text-[11px] tracking-wide text-slate-500">
          Powered by <span className="font-bold" style={{ color: 'var(--pp-accent)' }}>Taprevia</span>
        </p>
        <a
          href="https://taprevia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="pp-focus mx-auto mt-1.5 inline-flex min-h-11 items-center justify-center px-2 text-[11px] font-medium tracking-wide transition hover:underline"
          style={{ color: 'var(--pp-accent)' }}
        >
          Click here to create your digital business card
        </a>
      </footer>

      {/* ── VCF gate / exchange modal ─────────────────────────────────────── */}
      {modal !== 'closed' ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget && !modalBusy) setModal('closed'); }}>
          <form onSubmit={submitModal} noValidate role="dialog" aria-modal="true" aria-label={modal === 'vcf' ? 'Save contact details' : 'Exchange contact'} className="pp-root w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-pp-ink">{modal === 'vcf' ? 'Save Contact' : 'Exchange Contact'}</h2>
              <button type="button" onClick={() => setModal('closed')} aria-label="Close" className="pp-focus grid h-9 w-9 place-items-center rounded-full text-slate-500"><X size={18} /></button>
            </div>
            <p className="mb-3 text-xs text-slate-500">{modal === 'vcf' ? `Enter your details to save ${name}'s contact.` : `Share your details with ${name}.`}</p>
            <div className="space-y-2.5">
              <label htmlFor="pp-modal-name" className="sr-only">Your name</label>
              <input id="pp-modal-name" className={inputClass} placeholder="Your name" autoComplete="name" value={modalName} onChange={(e) => setModalName(e.target.value)} required />
              <label htmlFor="pp-modal-email" className="sr-only">Your email</label>
              <input id="pp-modal-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={modalEmail} onChange={(e) => setModalEmail(e.target.value)} required={modal === 'vcf'} />
              <label htmlFor="pp-modal-phone" className="sr-only">Your phone</label>
              <input id="pp-modal-phone" type="tel" className={inputClass} placeholder={modal === 'vcf' ? 'Phone number (optional)' : 'Your phone'} autoComplete="tel" value={modalPhone} onChange={(e) => setModalPhone(e.target.value)} required={modal === 'exchange'} />
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setModal('closed')} className="pp-focus h-11 flex-1 rounded-xl border border-violet-100 text-sm font-semibold text-slate-600">Cancel</button>
              <button type="submit" disabled={modalBusy} className="pp-grad pp-focus h-11 flex-1 rounded-xl text-sm font-bold text-white disabled:opacity-60">{modalBusy ? 'Please wait…' : modal === 'vcf' ? 'Save Contact' : 'Share'}</button>
            </div>
          </form>
        </div>
      ) : null}

      {/* ── Share fallback sheet (mirrors StickyDock) ────────────────────── */}
      {shareSheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Share ${name}'s card`}
          className="fixed inset-0 z-[65] flex items-end justify-center bg-black/50 p-0"
          onClick={(event) => { if (event.target === event.currentTarget) setShareSheetOpen(false); }}
        >
          <div className="pp-root mx-auto w-full max-w-md rounded-t-2xl bg-white p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl">
            {copied ? (
              <div role="status" className="flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium text-pp-ink">
                <Check size={18} className="text-emerald-600" aria-hidden="true" /> Link copied
              </div>
            ) : (
              <>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-pp-ink hover:bg-violet-50">
                  <BrandIcon platform="whatsapp" size={18} /> WhatsApp
                </a>
                <a href={`sms:?body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-pp-ink hover:bg-violet-50">
                  <MessageSquare size={18} aria-hidden="true" /> SMS
                </a>
                <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-pp-ink hover:bg-violet-50">
                  <Mail size={18} aria-hidden="true" /> Email
                </a>
                <button type="button" onClick={handleCopyLink} className="pp-focus flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-pp-ink hover:bg-violet-50">
                  <Link2 size={18} aria-hidden="true" /> Copy link
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* ── Shared gallery layers (grid + lightbox) ───────────────────────── */}
      {gallery.isGridOpen ? (
        <div ref={gallery.gridOverlayRef} role="presentation" onKeyDown={gallery.trapTabKeys} className="fixed inset-0 z-[70]">
          <div aria-hidden="true" className="absolute inset-0 bg-black/70" {...gallery.gridBackdropProps} />
          <div role="dialog" aria-modal="true" aria-label="Photo gallery" className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] max-w-md flex-col rounded-t-2xl bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-bold text-pp-ink">Gallery <span className="text-xs font-normal text-slate-500">{gallery.gridImages.length} photos</span></h2>
              <button type="button" onClick={gallery.closeGrid} aria-label="Close gallery" className="pp-focus grid h-9 w-9 place-items-center rounded-full text-slate-600"><X size={18} /></button>
            </div>
            <div ref={gallery.gridScrollRef} className="grid grid-cols-3 gap-2 overflow-y-auto">
              {gallery.gridImages.map((row, index) => (
                <figure key={`${row.url}-${index}`} className="min-w-0">
                  <button type="button" onClick={() => gallery.openGridImage(index)} aria-label={`Open photo ${index + 1} of ${gallery.gridImages.length}`} className="pp-focus aspect-square w-full overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                    <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                  </button>
                  {row.caption ? <figcaption className="mt-0.5 line-clamp-1 text-[10px] text-slate-500">{row.caption}</figcaption> : null}
                </figure>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {gallery.isImageOpen && gallery.current ? (
        <div ref={gallery.imageOverlayRef} role="presentation" onKeyDown={gallery.trapTabKeys} className="fixed inset-0 z-[80]">
          <div aria-hidden="true" className="absolute inset-0 bg-black/85" />
          <div role="dialog" aria-modal="true" aria-label="Photo viewer" {...gallery.touchHandlers} {...gallery.imageBackdropProps} className="absolute inset-0 grid place-items-center p-12">
            <span className="absolute left-4 top-4 text-xs font-medium text-white">{gallery.index + 1} / {gallery.total}</span>
            <button type="button" onClick={gallery.closeImage} aria-label="Close photo viewer" className="pp-focus absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white"><X size={20} /></button>
            <button type="button" onClick={() => gallery.step(-1)} aria-label="Previous photo" className="pp-focus absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronLeft size={20} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size customer image */}
            <img src={gallery.current.url} alt={`${name} gallery photo ${gallery.index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" onError={(e) => onImgError(e, name)} />
            <button type="button" onClick={() => gallery.step(1)} aria-label="Next photo" className="pp-focus absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronRight size={20} /></button>
            {gallery.current.caption ? <p className="absolute bottom-5 left-1/2 max-w-[85%] -translate-x-1/2 text-center text-xs text-white">{gallery.current.caption}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

