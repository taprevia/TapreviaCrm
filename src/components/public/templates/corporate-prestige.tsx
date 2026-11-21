'use client';

/**
 * CorporatePrestigeTemplate — a premium corporate public profile.
 *
 * Independent presentation layer: navy/deep-navy panels, fixed gold accents and
 * a restrained white/light canvas. Every customer-facing string and image comes
 * from the live `vcard` / `products` / `reviewCta` props; nothing is hardcoded.
 * All business logic (VCF download, contact exchange, enquiry, lead capture,
 * sharing, gallery viewing) is delegated to the same shared helpers and
 * endpoints used by the other public templates. No AI Review Assistant.
 *
 * Theme: the native signature (#0B1F36 / #FFFFFF) renders the full corporate
 * design. Saved custom colours only override the accent and page-canvas
 * tokens; the navy/gold decorative surfaces stay fixed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode, SyntheticEvent } from 'react';
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
  UserRound,
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
 * The single source for the asymmetric cover boundary. The HTML clip, the
 * page-coloured fill and both gold strokes all derive from this one path, so
 * the wave can never drift out of alignment. Tangents are C1-continuous at
 * every segment join.
 */
const COVER_WAVE_EDGE =
  'M0 .66 C .08 .655, .18 .69, .27 .735 C .38 .79, .46 .925, .56 .94 C .66 .955, .82 .84, 1 .80';
const COVER_WAVE_BODY = `${COVER_WAVE_EDGE} L1 0 L0 0 Z`;
const COVER_WAVE_FILL = `${COVER_WAVE_EDGE} L1 1 L0 1 Z`;

/**
 * Scoped theme tokens. Values come only from pre-validated #RRGGBB CSS vars
 * supplied by the public page / builder preview — no raw client CSS is
 * injected. Navy, deep navy and gold surfaces are fixed design elements.
 */
const STYLES = `
.cp-root{--cp-accent:#0B1F36;--cp-page:#FFFFFF;--cp-navy:#0B1F36;--cp-deep:#071629;--cp-gold:#D9A441;--cp-gold-soft:#F3E6C8;--cp-light:#F7F9FC;--cp-ink:#0B1F36;}
.cp-root.cp-custom-accent{--cp-accent:var(--v-accent,#0B1F36);}
.cp-root.cp-custom-bg{--cp-page:var(--v-bg,#FFFFFF);}
.cp-root{background:var(--cp-page);color:var(--cp-ink);}
/* The host shell applies an unlayered border-color token to every element.
   Re-assert this template's intentional gold/navy/status borders locally so
   the corporate framing is never replaced by a generic grey outline. */
.cp-root [class*="border-[#D9A441]"]{border-color:#D9A441!important;}
.cp-root [class*="border-[#D9A441]/35"]{border-color:rgba(217,164,65,.35)!important;}
.cp-root [class*="border-[#D9A441]/50"]{border-color:rgba(217,164,65,.5)!important;}
.cp-root [class*="border-[#D9A441]/55"]{border-color:rgba(217,164,65,.55)!important;}
.cp-root [class*="border-[#D9A441]/60"]{border-color:rgba(217,164,65,.6)!important;}
.cp-root [class*="border-[#D9A441]/65"]{border-color:rgba(217,164,65,.65)!important;}
.cp-root [class*="border-[#D9A441]/70"]{border-color:rgba(217,164,65,.7)!important;}
.cp-root [class*="border-[#D9A441]/75"]{border-color:rgba(217,164,65,.75)!important;}
.cp-root [class*="border-[#0B1F36]"]{border-color:#0B1F36!important;}
.cp-root [class*="border-[#0B1F36]/10"]{border-color:rgba(11,31,54,.10)!important;}
.cp-root [class*="border-[#0B1F36]/25"]{border-color:rgba(11,31,54,.25)!important;}
.cp-root [class*="border-[#FCA5A5]"]{border-color:#FCA5A5!important;}
.cp-panel{background:var(--cp-light);border:1px solid rgba(11,31,54,.10);box-shadow:0 10px 30px rgba(7,22,41,.08);}
.cp-card{background:#FFFFFF;border:1px solid rgba(11,31,54,.10);box-shadow:0 8px 22px rgba(7,22,41,.07);}
.cp-focus:focus-visible{outline:2px solid var(--cp-gold);outline-offset:2px;}
.cp-cover-scrim{background:linear-gradient(180deg,rgba(7,22,41,.62) 0%,rgba(7,22,41,.22) 34%,rgba(7,22,41,0) 68%);}
.cp-photo-frame{position:absolute;top:-46px;right:12px;}
@media(min-width:360px){.cp-photo-frame{top:-52px;right:16px;}}
@media(min-width:430px){.cp-photo-frame{top:-56px;right:20px;}}
.cp-profile-lead{min-height:64px;}
@media(min-width:360px){.cp-profile-lead{min-height:72px;}}
@media(min-width:430px){.cp-profile-lead{min-height:84px;}}
.cp-designation{background:linear-gradient(135deg,#F7E2B2,#D9A441);}
.cp-company-rule{background:linear-gradient(90deg,#B98A32,#D9A441);}
.cp-section-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#F7E2B2,#D9A441);color:#0B1F36;box-shadow:inset 0 0 0 1px rgba(185,138,50,.55),0 4px 10px rgba(7,22,41,.12);}
.cp-section-icon-dark{background:linear-gradient(135deg,#F7E2B2,#D9A441);color:#0B1F36;box-shadow:inset 0 0 0 1px rgba(255,255,255,.40);}
.cp-heading-rule{background:linear-gradient(90deg,#B98A32,#D9A441,#B98A32);border-radius:999px;}
.cp-nav-link{border-bottom:2px solid transparent;}
.cp-nav-link:hover,.cp-nav-link:focus-visible{border-bottom-color:var(--cp-gold);}
.cp-contact-panel{position:relative;background:linear-gradient(150deg,#0B1F36 0%,#071629 100%);border-top:3px solid var(--cp-gold);box-shadow:0 14px 34px rgba(7,22,41,.22);}
.cp-contact-panel::after{content:"";position:absolute;left:16px;right:16px;top:3px;height:1px;background:linear-gradient(90deg,transparent,rgba(217,164,65,.85),transparent);}
.cp-contact-input{background:#FFFFFF;color:var(--cp-navy);border:1px solid rgba(217,164,65,.42);}
.cp-contact-input::placeholder{color:#5D6B7A;}
.cp-contact-input:focus-visible{border-color:#D9A441;box-shadow:0 0 0 3px rgba(217,164,65,.20);}
.cp-actions{display:grid;grid-template-columns:1fr;gap:.5rem;}
@media(min-width:360px) and (max-width:439px){
  .cp-actions{grid-template-columns:repeat(2,minmax(0,1fr));}
  .cp-actions > :last-child:nth-child(odd){grid-column:1/-1;}
}
@media(min-width:440px){.cp-actions{grid-template-columns:repeat(auto-fit,minmax(0,1fr));}}
.cp-products-row{display:flex;gap:.7rem;overflow-x:auto;position:relative;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scroll-behavior:smooth;}
.cp-products-row::-webkit-scrollbar{display:none;}
.cp-products-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem;}
.cp-product-card{flex:0 0 68%;max-width:190px;min-width:142px;scroll-snap-align:start;}
@media(min-width:420px){.cp-product-card{flex:0 0 calc((100% - 1.4rem)/3);max-width:none;min-width:0;}}
/* Guide height matches the framed product image area (4:3) so edge arrows center on it. */
.cp-carousel-guide{position:absolute;top:0;left:0;right:0;height:0;padding-bottom:clamp(106px,51%,142px);pointer-events:none;z-index:20;}
@media(min-width:420px){.cp-carousel-guide{padding-bottom:calc(25% - .35rem);}}
.cp-services-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;}
/* Exactly three displayed services stay on one row at every width. */
.cp-services-grid-three{grid-template-columns:repeat(3,minmax(0,1fr));}
@media(max-width:419px){.cp-services-grid-three{gap:.4rem;}}
@media(max-width:359px){.cp-services-grid-three{gap:.3rem;}.cp-services-grid-three > *{padding-left:.4rem;padding-right:.4rem;}}
.cp-gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem;}
.cp-form-grid{display:grid;grid-template-columns:1fr;gap:.8rem;}
.cp-span-all{grid-column:1/-1;}
.cp-scroll::-webkit-scrollbar{height:4px;}
.cp-scroll::-webkit-scrollbar-thumb{background:#D9A441;border-radius:999px;}
@media(min-width:420px){
  .cp-services-grid{grid-template-columns:repeat(3,minmax(0,1fr));}
  .cp-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media(min-width:640px){.cp-gallery-grid{grid-template-columns:repeat(4,minmax(0,1fr));}}
@media (prefers-reduced-motion:reduce){
  .cp-root *,.cp-root *::before,.cp-root *::after{
    scroll-behavior:auto!important;transition-duration:0.01ms!important;
    animation-duration:0.01ms!important;animation-iteration-count:1!important;
  }
}
`;

const SERVICE_ICONS = [Gem, Crown, Sparkles, Gift, Heart, ShieldCheck, Package, Star];
const NAV_ICONS: Record<string, typeof Box> = {
  'About Us': UserRound,
  'Our Products': Box,
  'Our Services': Sparkles,
};

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
      `<rect width='480' height='360' fill='#071629'/>` +
      `<rect x='14' y='14' width='452' height='332' rx='12' fill='none' stroke='#D9A441' stroke-opacity='.75' stroke-width='2'/>` +
      `<path d='M168 150 L240 112 L312 150 L312 214 L240 252 L168 214 Z' fill='none' stroke='#D9A441' stroke-opacity='.65' stroke-width='4' stroke-linejoin='round'/>` +
      `<path d='M168 150 L240 188 L312 150 M240 188 L240 252' fill='none' stroke='#D9A441' stroke-opacity='.45' stroke-width='3'/>` +
      `<text x='240' y='300' text-anchor='middle' font-family='Georgia,serif' font-weight='bold' letter-spacing='2' font-size='22' fill='#FFFFFF'>${safe}</text></svg>`,
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
  return match ? match[1] : 'var(--cp-accent)';
}

const onImgError = (event: SyntheticEvent<HTMLImageElement>, label: string): void => {
  const img = event.currentTarget;
  if (img.dataset.cpfb === '1') return;
  img.dataset.cpfb = '1';
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
  dark = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  id?: string;
  dark?: boolean;
}) {
  return (
    <div className="mb-3.5 flex items-end gap-2.5">
      <span className={`cp-focus shrink-0 ${dark ? 'cp-section-icon-dark' : 'cp-section-icon'}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <span aria-hidden="true" className="cp-heading-rule mb-1 block h-[2px] w-8" />
        <h2 id={id} className={`font-serif text-base font-bold tracking-wide ${dark ? 'text-white' : 'text-[#0B1F36]'}`}>
          {children}
        </h2>
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  );
}

export function CorporatePrestigeTemplate({
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
  const company = vcard.basic?.company?.trim() || '';
  const showCompany = company.length > 0 && company.toLowerCase() !== designation.toLowerCase();
  const website = safeExternalUrl(
    (vcard.basic as { website?: string } | undefined)?.website?.trim() ||
      (vcard as IVcard & { website?: string }).website?.trim() ||
      '',
  );
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
  const aboutText = bio.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();

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
  const productLightboxImages = useMemo<GalleryImage[]>(
    () =>
      activeProducts.map((product) => ({
        url: product.imageUrl || fallbackImage(product.title),
        caption: '',
      })),
    [activeProducts]
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

  const navItems = useMemo(
    () =>
      [
        aboutText ? { href: '#cp-about', label: 'About Us' } : null,
        activeProducts.length > 0 ? { href: '#cp-products', label: 'Our Products' } : null,
        services.length > 0 ? { href: '#cp-services', label: 'Our Services' } : null,
      ].filter((item): item is { href: string; label: string } => item !== null),
    [aboutText, activeProducts.length, services.length],
  );

  // ── Theme signature ─────────────────────────────────────────────────────
  const accentHex = (vcard.themeConfig?.accentColor ?? '').trim().toUpperCase();
  const bgHex = (vcard.themeConfig?.bgColor ?? '').trim().toUpperCase();
  const isNativeTheme = accentHex === '#0B1F36' && bgHex === '#FFFFFF';
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
    'cp-focus cp-contact-input h-12 w-full rounded-xl px-3.5 text-base text-[#0B1F36] placeholder:text-[#5D6B7A] shadow-sm';
  const rootStyle = {
    '--cp-accent': themedAccent ? 'var(--v-accent, #0B1F36)' : '#0B1F36',
    '--cp-page': themedBg ? 'var(--v-bg, #FFFFFF)' : '#FFFFFF',
  } as CSSProperties;

  return (
    <div
      className={`cp-root relative mx-auto w-full overflow-hidden pb-28 font-sans shadow-[0_24px_70px_rgba(7,22,41,.18)]${themedAccent ? ' cp-custom-accent' : ''}${themedBg ? ' cp-custom-bg' : ''}`}
      style={rootStyle}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ── Cover ─────────────────────────────────────────────────────────── */}
      <header className="relative h-[190px] min-[430px]:h-[204px]">
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden"
          style={{ background: 'linear-gradient(120deg,var(--cp-navy),var(--cp-deep))' }}
        >
          {coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- customer cover image
            <img
              src={coverImage}
              alt=""
              onError={(e) => onImgError(e, name)}
              className="h-full w-full object-cover"
              style={{ clipPath: 'url(#cp-cover-html-clip)' }}
            />
          ) : null}
        </div>
        {/* Top-only scrim: share stays legible, the cover stays visible. */}
        <div
          aria-hidden="true"
          className="cp-cover-scrim absolute inset-0"
          style={{ opacity: coverImage ? 1 : 0, clipPath: 'url(#cp-cover-html-clip)' }}
        />
        {/* One flowing boundary drives the clip, page fill and gold accents. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        >
          <defs>
            <clipPath id="cp-cover-html-clip" clipPathUnits="objectBoundingBox">
              <path d={COVER_WAVE_BODY} />
            </clipPath>
            <linearGradient id="cp-gold-band" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#B98A32" />
              <stop offset="50%" stopColor="#D9A441" />
              <stop offset="100%" stopColor="#B98A32" />
            </linearGradient>
          </defs>
          <path d={COVER_WAVE_FILL} fill="var(--cp-page)" />
          <path
            d={COVER_WAVE_EDGE}
            fill="none"
            stroke="url(#cp-gold-band)"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={COVER_WAVE_EDGE}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity={0.45}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            transform="translate(0 0.014)"
          />
        </svg>
        <button
          type="button"
          onClick={handleShare}
          aria-label={`Share ${name}'s card`}
          className="cp-focus absolute right-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-full border border-[#D9A441]/75 bg-[#071629]/85 text-[#D9A441] shadow-md backdrop-blur transition hover:bg-[#0B1F36] min-[430px]:right-4 min-[430px]:top-4"
        >
          <Share2 size={16} aria-hidden="true" />
        </button>
      </header>

      {/* ── Profile identity ──────────────────────────────────────────────── */}
      <section id="cp-about" className="relative z-10 scroll-mt-4 px-5 pb-4 pt-1">
        {/* Square, gold-framed photo overlaps the cover's flowing edge. */}
        <div className="cp-photo-frame cp-focus h-24 w-24 rounded-lg border-[3px] border-[#D9A441] bg-white p-[3px] shadow-[0_14px_34px_rgba(7,22,41,.30)] ring-4 ring-white/90 min-[360px]:h-28 min-[360px]:w-28 min-[430px]:h-32 min-[430px]:w-32">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote/S3 avatar; sanitized upstream
            <img
              src={avatarUrl}
              alt={name}
              width={128}
              height={128}
              onError={(e) => onImgError(e, name)}
              className="h-full w-full rounded-[5px] object-cover"
            />
          ) : (
            <span className="grid h-full w-full place-items-center rounded-[5px] bg-[#F7F9FC] font-serif text-2xl font-bold text-[#0B1F36]">
              {initialsFor(name)}
            </span>
          )}
        </div>

        {/* Name starts beside the header; the copy column reserves photo width. */}
        <div className="cp-profile-lead min-w-0 pr-24 min-[360px]:pr-[116px] min-[430px]:pr-[136px]">
          <h1 className="break-words font-serif text-[26px] font-bold leading-[1.12] tracking-[-0.01em] text-[#0B1F36] sm:text-[30px]">
            {name}
          </h1>
          {designation ? (
            <span className="cp-designation mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-[#D9A441]/70 px-2.5 py-1 text-[11px] font-bold uppercase leading-snug tracking-[0.1em] text-[#0B1F36] min-[360px]:text-[12px]">
              <Gem size={11} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{designation}</span>
            </span>
          ) : null}
          {showCompany ? (
            <p className="mt-1.5 flex items-start gap-2 break-words text-[12px] font-semibold uppercase tracking-[0.14em] text-[#435569]">
              <span aria-hidden="true" className="cp-company-rule mt-[.55em] block h-px w-4 shrink-0" />
              <span className="min-w-0">{company}</span>
            </p>
          ) : null}
        </div>

        {/* Bio and contacts run full width below the photo. */}
        <div className="mt-2 min-w-0">
          {bio ? (
            <div className="text-[13px] leading-[1.7] text-[#33465C]">
              <SafeHtml html={bio} />
            </div>
          ) : null}

          {/* Compact contact rows wrap instead of clipping long values. */}
          {phoneLinks.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              {phoneLinks.map((row, index) => (
                <div key={`${row.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#F3E6C8] text-[#8A641E] ring-1 ring-[#D9A441]/45" aria-hidden="true">
                    <row.icon size={13} className="shrink-0" aria-hidden="true" />
                  </span>
                  {row.href ? (
                    <a href={row.href} className="cp-focus break-all text-[12px] font-medium text-[#0B1F36] hover:text-[#6B4A12]">
                      {row.value}
                    </a>
                  ) : (
                    <span className="break-all text-[12px] font-medium text-[#0B1F36]">{row.value}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Primary actions — navy primary, gold-outlined secondaries ─────── */}
      <section className="cp-actions mt-4 px-5" aria-label="Quick actions">
        <button
          type="button"
          onClick={addToContact}
          className="cp-focus cp-action-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[#0B1F36] bg-[#0B1F36] px-3 text-center text-[12px] font-bold leading-tight text-[#FFFFFF] shadow-md transition hover:-translate-y-0.5 hover:bg-[#071629] hover:shadow-lg active:scale-[0.99] min-[430px]:min-h-[48px]"
        >
          <UserPlus size={15} aria-hidden="true" /> Add to Contacts
        </button>
        <button
          type="button"
          onClick={() => { setNotice(null); setModalName(''); setModalEmail(''); setModalPhone(''); setModal('exchange'); }}
          className="cp-focus cp-action-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[#D9A441] bg-[#FFFFFF] px-3 text-center text-[12px] font-bold leading-tight text-[#0B1F36] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F7F9FC] hover:shadow-md active:scale-[0.99] min-[430px]:min-h-[48px]"
        >
          <ArrowLeftRight size={14} className="shrink-0 text-[#8A641E]" aria-hidden="true" /> Exchange Contact
        </button>
        {website ? (
          <a href={website} target="_blank" rel="noopener noreferrer" className="cp-focus cp-action-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[#D9A441] bg-[#FFFFFF] px-3 text-center text-[12px] font-bold leading-tight text-[#0B1F36] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F7F9FC] hover:shadow-md active:scale-[0.99] min-[430px]:min-h-[48px]">
            <Link2 size={14} className="shrink-0 text-[#8A641E]" aria-hidden="true" /> Website
          </a>
        ) : null}
        {reviewCta ? (
          <a href={reviewCta.href} aria-label={`Rate ${name} on Google`} className="cp-focus cp-action-btn flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full border border-[#D9A441] bg-[#FFFFFF] px-3 text-center text-[12px] font-bold leading-tight text-[#0B1F36] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F7F9FC] hover:shadow-md active:scale-[0.99] min-[430px]:min-h-[48px]">
            <Star size={14} className="shrink-0 text-[#8A641E]" aria-hidden="true" /> Rate us on Google
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
                className="cp-focus grid h-10 w-10 place-items-center rounded-xl border border-[#D9A441]/50 bg-[#FFFFFF] text-base shadow-sm transition hover:-translate-y-0.5 hover:border-[#D9A441] hover:shadow-md"
                style={{ color: socialIconColor(link.url) }}
              >
                {getBrandIcon(link.url)}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Corporate section navigation (only live destinations) ─────────── */}
      {navItems.length > 0 ? (
        <nav className="relative z-20 mt-6 border-t border-[#D9A441]/60 bg-[#0B1F36]" aria-label="Section navigation">
          <div className="cp-scroll mx-auto flex max-w-md overflow-x-auto">
            {navItems.map((item) => {
              const NavIcon = NAV_ICONS[item.label] ?? Box;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={(event) => {
                    const target = document.getElementById(item.href.slice(1));
                    if (!target) return;
                    event.preventDefault();
                    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
                  }}
                  aria-label={`Jump to ${item.label}`}
                  className="cp-focus cp-nav-link relative flex min-h-[56px] flex-1 shrink-0 flex-col items-center justify-center gap-1 px-2 py-1.5 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.1em] text-[#FFFFFF]/85 transition after:absolute after:bottom-2 after:right-0 after:top-2 after:w-px after:bg-[#D9A441]/35 hover:text-[#D9A441] min-[360px]:text-[11px] last:after:hidden"
                >
                  <NavIcon size={16} className="shrink-0 text-[#D9A441]" aria-hidden="true" />
                  <span className="whitespace-nowrap">{item.label}</span>
                </a>
              );
            })}
          </div>
        </nav>
      ) : null}

      {/* ── Products ──────────────────────────────────────────────────────── */}
      {activeProducts.length > 0 ? (
        <section id="cp-products" className="mt-7 scroll-mt-4 px-5" aria-labelledby="cp-products-head">
          <SectionHeading
            id="cp-products-head"
            icon={<Box size={16} />}
            action={
              activeProducts.length > VISIBLE_COUNT ? (
                <button type="button" onClick={() => setProductsExpanded((v) => !v)} className="cp-focus rounded-full border border-[#D9A441]/70 bg-[#F7E2B2] px-3 py-1.5 text-[11px] font-bold text-[#0B1F36] shadow-sm transition hover:bg-[#EED7A6]">
                  {productsExpanded ? 'Show Less' : 'See All Products'}
                </button>
              ) : null
            }
          >
            Our Products
          </SectionHeading>
          <div className="relative">
            <div
              id="cp-products-track"
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
              className={productsExpanded ? 'cp-products-grid' : 'cp-products-row cp-scroll pb-2'}
            >
              {activeProducts.map((product, index) => {
                const enquiry = waLink(`Hello ${name}! I'd like to enquire about your "${product.title}" product.`);
                return (
                  <article key={product._id || index} className={productsExpanded ? 'min-w-0' : 'cp-product-card'}>
                    <div className="cp-card overflow-hidden rounded-xl border-[#D9A441]/35">
                      <div className="p-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            gallery.openProductImage(productLightboxImages, index)
                          }
                          aria-label={`View ${product.title} photo`}
                          className="block w-full cursor-zoom-in border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-gold)]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- customer catalogue image */}
                          <img
                            src={product.imageUrl || fallbackImage(product.title)}
                            alt={product.title}
                            width={300}
                            height={240}
                            loading="lazy"
                            decoding="async"
                            onError={(e) => onImgError(e, product.title)}
                            className="aspect-[4/3] w-full rounded-lg bg-[#071629] object-cover"
                          />
                        </button>
                      </div>
                      <div className="px-2.5 pb-2.5 pt-0.5">
                        <h3 className="line-clamp-2 min-h-[34px] break-words text-[13px] font-bold leading-[1.25] text-[#0B1F36]">{product.title}</h3>
                        {enquiry ? (
                          <a href={enquiry} target="_blank" rel="noopener noreferrer" className="cp-focus mt-2 flex min-h-[34px] items-center justify-center gap-1.5 rounded-full border border-[#D9A441]/60 bg-[#F3E6C8] px-2 text-[11px] font-bold text-[#0B1F36] shadow-sm transition hover:bg-[#E8D5AC]">
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
              <div className="cp-carousel-guide">
                <button
                  type="button"
                  onClick={() => scrollProducts(-1)}
                  disabled={productNav.atStart}
                  aria-label="Previous products"
                  aria-controls="cp-products-track"
                  className="cp-focus pointer-events-auto absolute left-0 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#D9A441]/70 bg-[#FFFFFF] text-[#8A641E] shadow-[0_6px_16px_rgba(7,22,41,.22)] ring-2 ring-white/80 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollProducts(1)}
                  disabled={productNav.atEnd}
                  aria-label="Next products"
                  aria-controls="cp-products-track"
                  className="cp-focus pointer-events-auto absolute right-0 top-1/2 grid h-10 w-10 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[#D9A441]/70 bg-[#FFFFFF] text-[#8A641E] shadow-[0_6px_16px_rgba(7,22,41,.22)] ring-2 ring-white/80 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
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
        <section id="cp-services" className="mt-7 scroll-mt-4 px-5" aria-labelledby="cp-services-head">
          <div className="cp-panel rounded-xl px-3.5 py-4">
            <SectionHeading
              id="cp-services-head"
              icon={<Crown size={16} />}
              action={
                services.length > VISIBLE_COUNT ? (
                  <button type="button" onClick={() => setServicesExpanded((v) => !v)} className="cp-focus rounded-full border border-[#D9A441]/70 bg-[#F7E2B2] px-3 py-1.5 text-[11px] font-bold text-[#0B1F36] shadow-sm transition hover:bg-[#EED7A6]">
                    {servicesExpanded ? 'Show Less' : 'See All Services'}
                  </button>
                ) : null
              }
            >
              Our Services
            </SectionHeading>
            <div className={`cp-services-grid${displayedServices.length === VISIBLE_COUNT ? ' cp-services-grid-three' : ''}`}>
              {displayedServices.map((service, index) => {
                const Icon = SERVICE_ICONS[index % SERVICE_ICONS.length] ?? Sparkles;
                const enquiry = waLink(`Hello ${name}! I'm interested in ${service}. Please share details.`);
                return (
                  <div key={`${service}-${index}`} className="cp-card min-w-0 rounded-xl border-[#D9A441]/35 px-2 py-3.5 text-center shadow-sm">
                    <span className="cp-focus mx-auto mb-2 grid h-9 w-9 place-items-center rounded-lg bg-[#F3E6C8] text-[#8A641E] ring-1 ring-[#D9A441]/55">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <p className="line-clamp-2 break-words text-[12px] font-bold leading-tight text-[#0B1F36]">{service}</p>
                    {enquiry ? (
                      <a href={enquiry} target="_blank" rel="noopener noreferrer" aria-label={`Enquire about ${service}`} className="cp-focus mt-2 inline-flex min-h-[24px] items-center justify-center text-[11px] font-bold text-[#8A641E] underline decoration-[#D9A441]/60 underline-offset-2 transition hover:text-[#0B1F36]">
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
        <section className="mt-7 px-5" aria-labelledby="cp-gallery-head">
          <SectionHeading
            id="cp-gallery-head"
            icon={<Images size={16} />}
            action={
              <button type="button" onClick={() => gallery.openGrid(galleryImages)} className="cp-focus rounded-full border border-[#D9A441]/70 bg-[#0B1F36] px-3 py-1.5 text-[11px] font-bold text-[#FFFFFF] shadow-sm transition hover:bg-[#071629]">
                View All {galleryTotal} Photos
              </button>
            }
          >
            Gallery
          </SectionHeading>
          <div className="cp-gallery-grid">
            {galleryPreviewRows.map((row, index) => (
              <button
                key={`${row.url}-${index}`}
                type="button"
                onClick={() => gallery.openPreviewImage(galleryImages, index)}
                aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                className="cp-focus relative aspect-square overflow-hidden rounded-xl shadow-[0_10px_24px_rgba(7,22,41,.18)] ring-1 ring-[#0B1F36]/15 transition hover:shadow-[0_16px_30px_rgba(7,22,41,.26)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" decoding="async" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                {index === GALLERY_PREVIEW_COUNT - 1 && galleryExtra > 0 ? (
                  <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-[#071629]/90 via-[#071629]/60 to-transparent text-[11px] font-bold text-white">
                    +{galleryExtra} More
                  </span>
                ) : null}
                {index === firstCaptionedPreviewIndex && row.caption ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-[#071629]/90 to-transparent px-1.5 pb-1 pt-3 text-left text-[9px] font-medium text-white">
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
        <section className="mt-7 px-5" aria-labelledby="cp-hours-head">
          <SectionHeading id="cp-hours-head" icon={<Clock3 size={16} />}>Business Hours</SectionHeading>
          <div className="cp-panel space-y-1.5 rounded-xl p-4">
            {hours.map((row) => (
              <div key={row.day} className="flex items-center justify-between gap-3 border-b border-[#0B1F36]/10 pb-1.5 text-xs last:border-b-0 last:pb-0">
                <span className="font-semibold text-[#0B1F36]">{row.label}</span>
                <span className={row.closed ? 'italic text-[#6B4A12]' : 'tabular-nums text-[#33465C]'}>{row.time}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Get in touch ──────────────────────────────────────────────────── */}
      <section className="mt-7 px-5" aria-labelledby="cp-contact-head">
        <div className="cp-contact-panel rounded-xl p-4 sm:p-5">
          <SectionHeading id="cp-contact-head" icon={<Send size={16} />} dark>Get in touch</SectionHeading>
          <form onSubmit={submitLead} className="cp-form-grid" noValidate>
            <div><label htmlFor="cp-lead-name" className="sr-only">Name</label><input id="cp-lead-name" className={inputClass} placeholder="Your name" autoComplete="name" maxLength={100} value={leadName} onChange={(e) => setLeadName(e.target.value)} required /></div>
            <div><label htmlFor="cp-lead-email" className="sr-only">Email</label><input id="cp-lead-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} /></div>
            <div className="cp-span-all"><label htmlFor="cp-lead-phone" className="sr-only">Phone</label><input id="cp-lead-phone" type="tel" className={inputClass} placeholder="Phone number" autoComplete="tel" maxLength={20} value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} /></div>
            <div className="cp-span-all"><label htmlFor="cp-lead-message" className="sr-only">Message</label><textarea id="cp-lead-message" className={`${inputClass} h-24 resize-none py-2.5`} placeholder="Your message" maxLength={2000} value={leadMessage} onChange={(e) => setLeadMessage(e.target.value)} /></div>
            <button type="submit" disabled={leadBusy} className="cp-focus cp-span-all flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#D9A441] bg-[#D9A441] text-sm font-bold text-[#0B1F36] shadow-md transition hover:bg-[#E8C375] disabled:opacity-60">
              <Send size={16} aria-hidden="true" /> {leadBusy ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        </div>
      </section>

      {/* ── Notices ───────────────────────────────────────────────────────── */}
      {notice ? (
        <div role="status" className={`mx-5 mt-4 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${notice.kind === 'error' ? 'border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]' : 'border-[#D9A441]/70 bg-[#F3E6C8] text-[#0B1F36]'}`}>
          {notice.kind === 'success' ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
          {notice.text}
        </div>
      ) : null}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="mt-7 px-5 pb-1 pt-5 text-center">
        <span aria-hidden="true" className="mx-auto mb-2 block h-px w-12 bg-gradient-to-r from-transparent via-[#D9A441] to-transparent" />
        <p className="text-[11px] tracking-wide text-[#435569]">
          Powered by <span className="font-bold text-[#0B1F36]">Taprevia</span>
        </p>
        <a
          href="https://taprevia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="cp-focus mx-auto mt-1.5 inline-flex min-h-11 items-center justify-center px-2 text-[11px] font-medium tracking-wide text-[#0B1F36] transition hover:text-[#6B4A12] hover:underline"
        >
          Click here to create your digital business card
        </a>
      </footer>

      {/* ── VCF gate / exchange modal ─────────────────────────────────────── */}
      {modal !== 'closed' ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget && !modalBusy) setModal('closed'); }}>
          <form onSubmit={submitModal} noValidate role="dialog" aria-modal="true" aria-label={modal === 'vcf' ? 'Save contact details' : 'Exchange contact'} className="cp-root cp-panel w-full max-w-sm rounded-xl p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold tracking-wide text-[#0B1F36]">{modal === 'vcf' ? 'Save Contact' : 'Exchange Contact'}</h2>
              <button type="button" onClick={() => setModal('closed')} aria-label="Close" className="cp-focus grid h-9 w-9 place-items-center rounded-full text-[#435569]"><X size={18} /></button>
            </div>
            <p className="mb-3 text-xs text-[#435569]">{modal === 'vcf' ? `Enter your details to save ${name}'s contact.` : `Share your details with ${name}.`}</p>
            <div className="space-y-2.5">
              <label htmlFor="cp-modal-name" className="sr-only">Your name</label>
              <input id="cp-modal-name" className={inputClass} placeholder="Your name" autoComplete="name" value={modalName} onChange={(e) => setModalName(e.target.value)} required />
              <label htmlFor="cp-modal-email" className="sr-only">Your email</label>
              <input id="cp-modal-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={modalEmail} onChange={(e) => setModalEmail(e.target.value)} required={modal === 'vcf'} />
              <label htmlFor="cp-modal-phone" className="sr-only">Your phone</label>
              <input id="cp-modal-phone" type="tel" className={inputClass} placeholder={modal === 'vcf' ? 'Phone number (optional)' : 'Your phone'} autoComplete="tel" value={modalPhone} onChange={(e) => setModalPhone(e.target.value)} required={modal === 'exchange'} />
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setModal('closed')} className="cp-focus h-11 flex-1 rounded-lg border border-[#0B1F36]/25 text-sm font-semibold text-[#0B1F36]">Cancel</button>
              <button type="submit" disabled={modalBusy} className="cp-focus h-11 flex-1 rounded-lg border border-[#0B1F36] bg-[#0B1F36] text-sm font-bold text-[#FFFFFF] disabled:opacity-60">{modalBusy ? 'Please wait…' : modal === 'vcf' ? 'Save Contact' : 'Share'}</button>
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
          <div className="cp-root cp-panel mx-auto w-full max-w-md rounded-t-2xl p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl">
            {copied ? (
              <div role="status" className="flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium text-[#0B1F36]">
                <Check size={18} className="text-[#6B4A12]" aria-hidden="true" /> Link copied
              </div>
            ) : (
              <>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-[#0B1F36] hover:bg-[#FFFFFF]">
                  <BrandIcon platform="whatsapp" size={18} /> WhatsApp
                </a>
                <a href={`sms:?body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-[#0B1F36] hover:bg-[#FFFFFF]">
                  <MessageSquare size={18} aria-hidden="true" /> SMS
                </a>
                <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-[#0B1F36] hover:bg-[#FFFFFF]">
                  <Mail size={18} aria-hidden="true" /> Email
                </a>
                <button type="button" onClick={handleCopyLink} className="cp-focus flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-[#0B1F36] hover:bg-[#FFFFFF]">
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
          <div role="dialog" aria-modal="true" aria-label="Photo gallery" className="cp-root cp-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] max-w-md flex-col rounded-t-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold tracking-wide text-[#0B1F36]">Gallery <span className="text-xs font-normal text-[#435569]">{gallery.gridImages.length} photos</span></h2>
              <button type="button" onClick={gallery.closeGrid} aria-label="Close gallery" className="cp-focus grid h-9 w-9 place-items-center rounded-full text-[#0B1F36]"><X size={18} /></button>
            </div>
            <div ref={gallery.gridScrollRef} className="grid grid-cols-3 gap-2 overflow-y-auto">
              {gallery.gridImages.map((row, index) => (
                <figure key={`${row.url}-${index}`} className="min-w-0">
                  <button type="button" onClick={() => gallery.openGridImage(index)} aria-label={`Open photo ${index + 1} of ${gallery.gridImages.length}`} className="cp-focus aspect-square w-full overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                    <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                  </button>
                  {row.caption ? <figcaption className="mt-0.5 line-clamp-1 text-[10px] text-[#435569]">{row.caption}</figcaption> : null}
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
            <button type="button" onClick={gallery.closeImage} aria-label="Close photo viewer" className="cp-focus absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white"><X size={20} /></button>
            <button type="button" onClick={() => gallery.step(-1)} aria-label="Previous photo" className="cp-focus absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronLeft size={20} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size customer image */}
            <img src={gallery.current.url} alt={`${name} gallery photo ${gallery.index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" onError={(e) => onImgError(e, name)} />
            <button type="button" onClick={() => gallery.step(1)} aria-label="Next photo" className="cp-focus absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronRight size={20} /></button>
            {gallery.current.caption ? <p className="absolute bottom-5 left-1/2 max-w-[85%] -translate-x-1/2 text-center text-xs text-white">{gallery.current.caption}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
