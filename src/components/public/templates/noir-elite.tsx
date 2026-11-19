'use client';

/**
 * NoirEliteTemplate — premium black-and-copper public profile.
 *
 * Independent presentation-only template. Every customer-facing string and
 * image comes from the live `vcard` / `products` / `reviewCta` props; nothing
 * is hardcoded. All business logic (VCF download, contact exchange, enquiry,
 * lead capture, sharing, gallery viewing, sticky navigation) is delegated to
 * existing, shared helpers and endpoints. No AI Review Assistant is rendered.
 *
 * Theme: the native signature (accent #C08A4A / bg #0B0B0D) renders the full
 * black-and-copper design. Saved custom colours only override the accent and
 * page-canvas tokens. The copper decoration, curved cover edge and dark-glass
 * surfaces are fixed design elements and are never themed.
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
 * copper outline. Unit coordinates map to the cover box, so the same path scales
 * with any viewport width and the two layers cannot drift apart.
 */
const COVER_WAVE_EDGE = 'M0 .76 C .28 .98, .72 .98, 1 .76';
const COVER_WAVE_BODY = `${COVER_WAVE_EDGE} L1 0 L0 0 Z`;

/**
 * Scoped theme tokens. Values come only from pre-validated #RRGGBB CSS vars
 * supplied by the public page / builder preview — no raw client CSS is
 * injected. The copper palette and curved cover geometry are fixed design.
 */
const STYLES = `
.ne-root{--ne-accent:#C08A4A;--ne-accent-2:#E8C38B;--ne-page:#0B0B0D;--ne-gold:#C08A4A;--ne-gold-light:#E8C38B;--ne-navy:#0B0B0D;--ne-navy-2:#161418;--ne-deep:#1A1714;--ne-magenta:#6E4A26;--ne-lav:#17151A;--ne-ink:#F5EEE4;}
.ne-root.ne-custom-accent{--ne-accent:var(--v-accent,#C08A4A);}
.ne-root.ne-custom-bg{--ne-page:var(--v-bg,#0B0B0D);}
.ne-root{background:var(--ne-page);color:var(--ne-ink);}
.ne-panel{background:linear-gradient(160deg,rgba(28,26,29,.94),rgba(14,13,15,.96));border:1px solid rgba(192,138,74,.28);box-shadow:0 12px 32px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.04);}
.ne-card{background:linear-gradient(160deg,rgba(30,28,31,.92),rgba(16,15,17,.96));border:1px solid rgba(192,138,74,.2);box-shadow:0 8px 24px rgba(0,0,0,.35);}
.ne-outline{border:1px solid rgba(192,138,74,.38);}
.ne-grad{background-image:linear-gradient(135deg,var(--ne-accent),var(--ne-accent-2));}
.ne-wave-gold{stroke:var(--ne-gold);}
.ne-wave-gold-light{stroke:var(--ne-gold-light);}
.ne-ring{background:linear-gradient(135deg,var(--ne-gold-light),var(--ne-gold));}
.ne-focus:focus-visible{outline:2px solid var(--ne-accent);outline-offset:2px;}
.ne-shimmer{background-color:#171519;background-image:linear-gradient(135deg,#201D20,#121114);}
.ne-root .text-ne-ink{color:var(--ne-ink);}
.ne-root .bg-ne-lav{background-color:var(--ne-lav);}
.ne-root .bg-ne-navy{background-color:var(--ne-navy);}
.ne-photo-shadow{box-shadow:0 14px 34px rgba(0,0,0,.65);}
.ne-actions{display:grid;grid-template-columns:1fr;gap:.5rem;}
/* Action labels stay on one line when the row has room to hold all four. */
@media(min-width:360px) and (max-width:439px){
  .ne-actions{grid-template-columns:repeat(2,minmax(0,1fr));}
  .ne-actions > :last-child:nth-child(odd){grid-column:1/-1;}
}
@media(min-width:440px){
  .ne-actions{grid-template-columns:repeat(auto-fit,minmax(0,1fr));}
  .ne-root .ne-action-btn{white-space:nowrap;font-size:9px;}
}
.ne-products-row{display:flex;gap:.6rem;overflow-x:auto;position:relative;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scroll-behavior:smooth;}
.ne-products-row::-webkit-scrollbar{display:none;}
.ne-products-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;}
.ne-product-card{flex:0 0 64%;max-width:170px;min-width:132px;scroll-snap-align:start;}
@media(min-width:420px){.ne-product-card{flex:0 0 calc((100% - 1.2rem)/3);max-width:none;min-width:0;}}
/* Height guide matches the product image area (4:3) so edge arrows center on it. */
.ne-carousel-guide{position:absolute;top:0;left:0;right:0;height:0;padding-bottom:clamp(99px,48%,127.5px);pointer-events:none;z-index:20;}
@media(min-width:420px){.ne-carousel-guide{padding-bottom:calc(25% - .3rem);}}
.ne-services-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;}
/* Exactly three displayed services stay on one row at every width. */
.ne-services-grid-three{grid-template-columns:repeat(3,minmax(0,1fr));}
@media(max-width:419px){.ne-services-grid-three{gap:.4rem;}}
@media(max-width:359px){.ne-services-grid-three{gap:.3rem;}.ne-services-grid-three > *{padding-left:.4rem;padding-right:.4rem;}}
.ne-gallery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.4rem;}
.ne-form-grid{display:grid;grid-template-columns:1fr;gap:.7rem;}
.ne-span-all{grid-column:1/-1;}
.ne-scroll::-webkit-scrollbar{height:4px;}
.ne-scroll::-webkit-scrollbar-thumb{background:#5B432C;border-radius:999px;}
@media(min-width:420px){
  .ne-services-grid{grid-template-columns:repeat(3,minmax(0,1fr));}
  .ne-form-grid{grid-template-columns:repeat(2,minmax(0,1fr));}
}
@media(min-width:640px){.ne-gallery-grid{grid-template-columns:repeat(4,minmax(0,1fr));}}
@media (prefers-reduced-motion:reduce){
  .ne-root *,.ne-root *::before,.ne-root *::after{
    scroll-behavior:auto!important;transition-duration:0.01ms!important;
    animation-duration:0.01ms!important;animation-iteration-count:1!important;
  }
}
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
      `<rect width='480' height='360' fill='#111013'/>` +
      `<rect x='12' y='12' width='456' height='336' rx='20' fill='none' stroke='#C08A4A' stroke-opacity='.55' stroke-width='2'/>` +
      `<g transform='translate(240 148)' fill='none' stroke='#E8C38B' stroke-opacity='.72' stroke-width='5' stroke-linejoin='round'>` +
      `<path d='M-34 -14 L0 -32 L34 -14 L34 22 L0 40 L-34 22 Z'/><path d='M-34 -14 L0 4 L34 -14 M0 4 L0 40'/></g>` +
      `<text x='240' y='268' text-anchor='middle' font-family='Georgia,serif' font-weight='bold' letter-spacing='2' font-size='22' fill='#F5EEE4'>${safe}</text></svg>`,
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
  return match ? match[1] : 'var(--ne-accent)';
}

const onImgError = (event: SyntheticEvent<HTMLImageElement>, label: string): void => {
  const img = event.currentTarget;
  if (img.dataset.nefb === '1') return;
  img.dataset.nefb = '1';
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
      <span className="ne-ring ne-focus grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[#1A140D] shadow-sm">
        {icon}
      </span>
      <h2 id={id} className="font-serif text-base font-semibold tracking-wide text-ne-ink">
        {children}
      </h2>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

export function NoirEliteTemplate({
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
  const isNativeTheme = accentHex === '#C08A4A' && bgHex === '#0B0B0D';
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
    'ne-focus h-11 w-full rounded-lg border border-[#C08A4A]/25 bg-[#121114] px-3 text-base text-ne-ink placeholder:text-[#8A8178] shadow-sm';
  const rootStyle = {
    '--ne-accent': themedAccent ? 'var(--v-accent, #C08A4A)' : '#C08A4A',
    '--ne-page': themedBg ? 'var(--v-bg, #0B0B0D)' : '#0B0B0D',
  } as CSSProperties;

  return (
    <div
      className={`ne-root relative mx-auto w-full overflow-hidden pb-28 font-sans shadow-[0_24px_70px_rgba(0,0,0,.65)]${themedAccent ? ' ne-custom-accent' : ''}${themedBg ? ' ne-custom-bg' : ''}`}
      style={rootStyle}
    >
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      {/* ── Cover ─────────────────────────────────────────────────────────── */}
      {/* Fixed cover box keeps the curve and profile-photo overlap stable. */}
      <header className="relative overflow-hidden" style={{ minHeight: 204, paddingBottom: 96 }}>
        {/* Shared geometry: CSS clip for HTML layers, SVG clip for decorative shapes. */}
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <defs>
            <clipPath id="ne-cover-html-clip" clipPathUnits="objectBoundingBox">
              <path d={COVER_WAVE_BODY} />
            </clipPath>
            <clipPath id="ne-cover-svg-clip" clipPathUnits="userSpaceOnUse">
              <path d={COVER_WAVE_BODY} />
            </clipPath>
          </defs>
        </svg>

        {/* black base with restrained bronze corner light */}
        <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <defs>
            <linearGradient id="ne-diag" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#E8C38B" stopOpacity=".18" />
              <stop offset="1" stopColor="#C08A4A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={COVER_WAVE_BODY} fill="#0B0B0D" />
          <g clipPath="url(#ne-cover-svg-clip)">
            <path d="M-.1 0 L.3 0 L-.1 .82 Z" fill="url(#ne-diag)" />
            <path d="M1.1 0 L.7 0 L1.1 .86 Z" fill="url(#ne-diag)" opacity=".8" />
            <path d="M-.05 .27 L.45 -.14 M-.05 .43 L.53 -.05 M1.03 .32 L.58 -.09 M1.03 .5 L.65 .05" stroke="var(--ne-gold-light)" strokeOpacity=".12" strokeWidth=".8" vectorEffect="non-scaling-stroke" fill="none" />
          </g>
        </svg>

        {/* existing customer cover image, clipped to the same wave */}
        {coverImage ? (
          <div aria-hidden="true" className="absolute inset-0" style={{ clipPath: 'url(#ne-cover-html-clip)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- customer cover image */}
            <img
              src={coverImage}
              alt=""
              onError={(e) => onImgError(e, name)}
              className="h-full w-full object-cover opacity-[0.82]"
            />
          </div>
        ) : null}

        {/* soft black scrim with warm bronze edge light */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            clipPath: 'url(#ne-cover-html-clip)',
            // Keep the native gradient at full strength when no cover image
            // exists; soften it into a contrast scrim when one does.
            opacity: coverImage ? 0.62 : 1,
            background:
              'radial-gradient(95% 85% at 0% 6%, rgba(192,138,74,.28) 0%, transparent 58%),' +
              'radial-gradient(95% 85% at 100% 6%, rgba(92,58,24,.26) 0%, transparent 58%),' +
              'linear-gradient(180deg, rgba(8,8,9,.24) 0%, rgba(8,8,9,.86) 100%)',
          }}
        />

        {/* share button */}
        <button
          type="button"
          onClick={handleShare}
          aria-label={`Share ${name}'s card`}
          className="ne-focus absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-[#C08A4A]/50 bg-[#121114]/85 text-[#E8C38B] shadow-md backdrop-blur transition hover:bg-[#1B181B]"
        >
          <Share2 size={16} aria-hidden="true" />
        </button>

        {/* metallic copper band on the exact same boundary as the clipped cover */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <defs>
            <linearGradient id="ne-gold-band" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7A4E22" />
              <stop offset=".45" stopColor="#E8C38B" />
              <stop offset="1" stopColor="#A87132" />
            </linearGradient>
          </defs>
          <path d={COVER_WAVE_EDGE} fill="none" stroke="url(#ne-gold-band)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={COVER_WAVE_EDGE} transform="translate(0 .014)" fill="none" stroke="var(--ne-gold-light)" strokeWidth="1" strokeOpacity=".65" vectorEffect="non-scaling-stroke" />
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
              className="ne-ring ne-photo-shadow mx-auto h-24 w-24 rounded-full border-[3px] border-[#E8C38B]/70 object-cover p-[3px]"
            />
          ) : (
            <div className="ne-ring ne-photo-shadow mx-auto grid h-24 w-24 place-items-center rounded-full border-[3px] border-[#E8C38B]/70 p-[3px] text-2xl font-bold text-[#F5EEE4] shadow-lg">
              <span className="grid h-full w-full place-items-center rounded-full bg-ne-deep" style={{ backgroundColor: 'var(--ne-deep)' }}>
                {initialsFor(name)}
              </span>
            </div>
          )}
        </div>
        <h1 className="mt-3 break-words font-serif text-xl font-semibold tracking-wide text-ne-ink sm:text-2xl">{name}</h1>
        {designation ? (
          <span className="ne-outline mt-2 inline-block rounded-full bg-[#17151A] px-3 py-1 text-xs font-semibold" style={{ color: 'var(--ne-accent)' }}>
            {designation}
          </span>
        ) : null}
        {showCompany ? (
          <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[#9C9186]">{company}</p>
        ) : null}
        {bio ? (
          <div className="mx-auto mt-2.5 max-w-md text-[13px] leading-relaxed text-[#BDB4A8]">
            <SafeHtml html={bio} />
          </div>
        ) : null}

        {/* contact rows */}
        {phoneLinks.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5">
            {phoneLinks.map((row, index) => (
              <div key={`${row.label}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true" className="h-3.5 w-px bg-[#C08A4A]/30" /> : null}
                {row.href ? (
                  <a href={row.href} className="ne-focus inline-flex items-center gap-1.5 text-[12px] font-medium text-ne-ink hover:opacity-70">
                    <row.icon size={14} style={{ color: 'var(--ne-accent)' }} aria-hidden="true" />
                    <span className="max-w-[150px] truncate">{row.value}</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ne-ink">
                    <row.icon size={14} style={{ color: 'var(--ne-accent)' }} aria-hidden="true" />
                    <span className="max-w-[150px] truncate">{row.value}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Primary actions — balanced compact row, responsive fallback ──── */}
      <section className="ne-actions mt-5 px-5" aria-label="Quick actions">
        <button type="button" onClick={addToContact} className="ne-grad ne-action-btn ne-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold leading-tight text-[#17120C] shadow-md transition active:scale-[0.99]">
          <UserPlus size={14} aria-hidden="true" /> Add to Contacts
        </button>
        <button
          type="button"
          onClick={() => { setNotice(null); setModalName(''); setModalEmail(''); setModalPhone(''); setModal('exchange'); }}
          className="ne-outline ne-action-btn ne-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl bg-[#17151A] px-1 text-center text-[10px] font-bold leading-tight shadow-sm transition active:scale-[0.99]"
          style={{ color: 'var(--ne-accent)' }}
        >
          <ArrowLeftRight size={14} aria-hidden="true" /> Exchange Contact
        </button>
        {website ? (
          <a href={website} target="_blank" rel="noopener noreferrer" className="ne-outline ne-action-btn ne-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl bg-[#17151A] px-1 text-center text-[10px] font-bold leading-tight shadow-sm transition active:scale-[0.99]" style={{ color: 'var(--ne-accent)' }}>
            <Link2 size={14} aria-hidden="true" /> Website
          </a>
        ) : null}
        {reviewCta ? (
          <a href={reviewCta.href} aria-label={`Rate ${name} on Google`} className="ne-outline ne-action-btn ne-focus flex min-h-[46px] w-full items-center justify-center gap-1 rounded-xl bg-[#17151A] px-1 text-center text-[10px] font-bold leading-tight shadow-sm transition active:scale-[0.99]" style={{ color: 'var(--ne-accent)' }}>
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
                className="ne-outline ne-focus grid h-10 w-10 place-items-center rounded-xl bg-[#17151A] text-base shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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
        <section className="mt-7 px-5" aria-labelledby="ne-products-head">
          <SectionHeading
            id="ne-products-head"
            icon={<Box size={16} />}
            action={
              activeProducts.length > VISIBLE_COUNT ? (
                <button type="button" onClick={() => setProductsExpanded((v) => !v)} className="ne-focus text-xs font-bold" style={{ color: 'var(--ne-accent)' }}>
                  {productsExpanded ? 'Show Less' : 'See All Products'}
                </button>
              ) : null
            }
          >
            Products
          </SectionHeading>
          <div className="relative">
            <div
              id="ne-products-track"
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
              className={productsExpanded ? 'ne-products-grid' : 'ne-products-row ne-scroll pb-2'}
            >
              {activeProducts.map((product, index) => {
                const enquiry = waLink(`Hello ${name}! I'd like to enquire about your "${product.title}" product.`);
                return (
                  <article key={product._id || index} className={productsExpanded ? 'min-w-0' : 'ne-product-card'}>
                    <div className="ne-card overflow-hidden rounded-xl">
                      {/* eslint-disable-next-line @next/next/no-img-element -- customer catalogue image */}
                      <img
                        src={product.imageUrl || fallbackImage(product.title)}
                        alt={product.title}
                        width={300}
                        height={240}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => onImgError(e, product.title)}
                        className="ne-shimmer aspect-[4/3] w-full object-cover"
                      />
                      <div className="p-2">
                        <h3 className="line-clamp-2 text-[11px] font-bold leading-tight text-ne-ink">{product.title}</h3>
                        {enquiry ? (
                          <a href={enquiry} target="_blank" rel="noopener noreferrer" className="ne-grad ne-focus mt-2 flex min-h-[32px] items-center justify-center gap-1 rounded-lg px-1.5 text-[10px] font-bold text-[#17120C] transition hover:brightness-110">
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
              <div className="ne-carousel-guide">
                <button
                  type="button"
                  onClick={() => scrollProducts(-1)}
                  disabled={productNav.atStart}
                  aria-label="Previous products"
                  aria-controls="ne-products-track"
                  className="ne-outline ne-focus pointer-events-auto absolute left-0 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#17151A]/95 shadow-md backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: 'var(--ne-accent)' }}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollProducts(1)}
                  disabled={productNav.atEnd}
                  aria-label="Next products"
                  aria-controls="ne-products-track"
                  className="ne-outline ne-focus pointer-events-auto absolute right-0 top-1/2 grid h-10 w-10 translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#17151A]/95 shadow-md backdrop-blur-sm transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: 'var(--ne-accent)' }}
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
        <section className="mt-7 px-5" aria-labelledby="ne-services-head">
          <div className="ne-panel rounded-2xl px-3.5 py-4">
            <SectionHeading
              id="ne-services-head"
              icon={<Crown size={16} />}
              action={
                services.length > VISIBLE_COUNT ? (
                  <button type="button" onClick={() => setServicesExpanded((v) => !v)} className="ne-focus text-xs font-bold" style={{ color: 'var(--ne-accent)' }}>
                    {servicesExpanded ? 'Show Less' : 'See All Services'}
                  </button>
                ) : null
              }
            >
              Services
            </SectionHeading>
            <div className={`ne-services-grid${displayedServices.length === VISIBLE_COUNT ? ' ne-services-grid-three' : ''}`}>
              {displayedServices.map((service, index) => {
                const Icon = SERVICE_ICONS[index % SERVICE_ICONS.length] ?? Sparkles;
                const enquiry = waLink(`Hello ${name}! I'm interested in ${service}. Please share details.`);
                return (
                  <div key={`${service}-${index}`} className="ne-card ne-outline min-w-0 rounded-xl px-2 py-3 text-center">
                    <span className="ne-focus mx-auto mb-1.5 grid h-8 w-8 place-items-center rounded-lg bg-[#221D18]" style={{ color: 'var(--ne-accent)' }}>
                      <Icon size={15} aria-hidden="true" />
                    </span>
                    <p className="line-clamp-2 break-words text-[11px] font-bold leading-tight text-ne-ink">{service}</p>
                    {enquiry ? (
                      <a href={enquiry} target="_blank" rel="noopener noreferrer" aria-label={`Enquire about ${service}`} className="ne-focus mt-1.5 inline-flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--ne-accent)' }}>
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
        <section className="mt-7 px-5" aria-labelledby="ne-gallery-head">
          <SectionHeading
            id="ne-gallery-head"
            icon={<Images size={16} />}
            action={
              <button type="button" onClick={() => gallery.openGrid(galleryImages)} className="ne-focus text-xs font-bold" style={{ color: 'var(--ne-accent)' }}>
                View All {galleryTotal} Photos
              </button>
            }
          >
            Gallery
          </SectionHeading>
          <div className="ne-gallery-grid">
            {galleryPreviewRows.map((row, index) => (
              <button
                key={`${row.url}-${index}`}
                type="button"
                onClick={() => gallery.openPreviewImage(galleryImages, index)}
                aria-label={`Open photo ${index + 1} of ${galleryTotal}`}
                className="ne-focus relative aspect-square overflow-hidden rounded-lg shadow-sm ring-1 ring-[#C08A4A]/25"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" decoding="async" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                {index === GALLERY_PREVIEW_COUNT - 1 && galleryExtra > 0 ? (
                  <span className="absolute inset-0 grid place-items-center bg-gradient-to-t from-black/85 via-black/55 to-transparent text-[11px] font-bold text-white">
                    +{galleryExtra} More
                  </span>
                ) : null}
                {index === firstCaptionedPreviewIndex && row.caption ? (
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-3 text-left text-[9px] font-medium text-white">
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
        <section className="mt-7 px-5" aria-labelledby="ne-hours-head">
          <SectionHeading id="ne-hours-head" icon={<Clock3 size={16} />}>Business Hours</SectionHeading>
          <div className="ne-panel space-y-1.5 rounded-2xl p-4">
            {hours.map((row) => (
              <div key={row.day} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-ne-ink">{row.label}</span>
                <span className={row.closed ? 'italic text-[#7C736A]' : 'tabular-nums text-[#BDB4A8]'}>{row.time}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── Get in touch ──────────────────────────────────────────────────── */}
      <section className="mt-7 px-5" aria-labelledby="ne-contact-head">
        <div className="ne-panel rounded-2xl p-4">
          <SectionHeading id="ne-contact-head" icon={<Send size={16} />}>Get in touch</SectionHeading>
          <form onSubmit={submitLead} className="ne-form-grid" noValidate>
            <div><label htmlFor="ne-lead-name" className="sr-only">Name</label><input id="ne-lead-name" className={inputClass} placeholder="Your name" autoComplete="name" maxLength={100} value={leadName} onChange={(e) => setLeadName(e.target.value)} required /></div>
            <div><label htmlFor="ne-lead-email" className="sr-only">Email</label><input id="ne-lead-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} /></div>
            <div className="ne-span-all"><label htmlFor="ne-lead-phone" className="sr-only">Phone</label><input id="ne-lead-phone" type="tel" className={inputClass} placeholder="Phone number" autoComplete="tel" maxLength={20} value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} /></div>
            <div className="ne-span-all"><label htmlFor="ne-lead-message" className="sr-only">Message</label><textarea id="ne-lead-message" className={`${inputClass} h-24 resize-none py-2.5`} placeholder="Your message" maxLength={2000} value={leadMessage} onChange={(e) => setLeadMessage(e.target.value)} /></div>
            <button type="submit" disabled={leadBusy} className="ne-grad ne-focus ne-span-all flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-[#17120C] shadow-md transition disabled:opacity-60">
              <Send size={16} aria-hidden="true" /> {leadBusy ? 'Sending…' : 'Send Message'}
            </button>
          </form>
        </div>
      </section>

      {/* ── Notices ───────────────────────────────────────────────────────── */}
      {notice ? (
        <div role="status" className={`ne-outline mx-5 mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${notice.kind === 'error' ? 'bg-[#2A1618] text-[#FCA5A5]' : 'bg-[#14261D] text-[#7DD3A8]'}`}>
          {notice.kind === 'success' ? <Check size={16} aria-hidden="true" /> : <X size={16} aria-hidden="true" />}
          {notice.text}
        </div>
      ) : null}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="mt-7 px-5 pb-1 pt-5 text-center">
        <span aria-hidden="true" className="mx-auto mb-2 block h-px w-12 bg-gradient-to-r from-transparent via-[var(--ne-gold)] to-transparent" />
        <p className="text-[11px] tracking-wide text-[#9C9186]">
          Powered by <span className="font-bold" style={{ color: 'var(--ne-accent)' }}>Taprevia</span>
        </p>
        <a
          href="https://taprevia.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="ne-focus mx-auto mt-1.5 inline-flex min-h-11 items-center justify-center px-2 text-[11px] font-medium tracking-wide transition hover:underline"
          style={{ color: 'var(--ne-accent)' }}
        >
          Click here to create your digital business card
        </a>
      </footer>

      {/* ── VCF gate / exchange modal ─────────────────────────────────────── */}
      {modal !== 'closed' ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" onClick={(e) => { if (e.target === e.currentTarget && !modalBusy) setModal('closed'); }}>
          <form onSubmit={submitModal} noValidate role="dialog" aria-modal="true" aria-label={modal === 'vcf' ? 'Save contact details' : 'Exchange contact'} className="ne-root ne-panel w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold tracking-wide text-ne-ink">{modal === 'vcf' ? 'Save Contact' : 'Exchange Contact'}</h2>
              <button type="button" onClick={() => setModal('closed')} aria-label="Close" className="ne-focus grid h-9 w-9 place-items-center rounded-full text-[#9C9186]"><X size={18} /></button>
            </div>
            <p className="mb-3 text-xs text-[#9C9186]">{modal === 'vcf' ? `Enter your details to save ${name}'s contact.` : `Share your details with ${name}.`}</p>
            <div className="space-y-2.5">
              <label htmlFor="ne-modal-name" className="sr-only">Your name</label>
              <input id="ne-modal-name" className={inputClass} placeholder="Your name" autoComplete="name" value={modalName} onChange={(e) => setModalName(e.target.value)} required />
              <label htmlFor="ne-modal-email" className="sr-only">Your email</label>
              <input id="ne-modal-email" type="email" className={inputClass} placeholder="Email address" autoComplete="email" value={modalEmail} onChange={(e) => setModalEmail(e.target.value)} required={modal === 'vcf'} />
              <label htmlFor="ne-modal-phone" className="sr-only">Your phone</label>
              <input id="ne-modal-phone" type="tel" className={inputClass} placeholder={modal === 'vcf' ? 'Phone number (optional)' : 'Your phone'} autoComplete="tel" value={modalPhone} onChange={(e) => setModalPhone(e.target.value)} required={modal === 'exchange'} />
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setModal('closed')} className="ne-focus h-11 flex-1 rounded-xl border border-[#C08A4A]/25 text-sm font-semibold text-[#BDB4A8]">Cancel</button>
              <button type="submit" disabled={modalBusy} className="ne-grad ne-focus h-11 flex-1 rounded-xl text-sm font-bold text-[#17120C] disabled:opacity-60">{modalBusy ? 'Please wait…' : modal === 'vcf' ? 'Save Contact' : 'Share'}</button>
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
          <div className="ne-root ne-panel mx-auto w-full max-w-md rounded-t-2xl p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl">
            {copied ? (
              <div role="status" className="flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium text-ne-ink">
                <Check size={18} className="text-[#7DD3A8]" aria-hidden="true" /> Link copied
              </div>
            ) : (
              <>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} target="_blank" rel="noopener noreferrer" className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-ne-ink hover:bg-[#1E1B20]">
                  <BrandIcon platform="whatsapp" size={18} /> WhatsApp
                </a>
                <a href={`sms:?body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-ne-ink hover:bg-[#1E1B20]">
                  <MessageSquare size={18} aria-hidden="true" /> SMS
                </a>
                <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} className="flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-ne-ink hover:bg-[#1E1B20]">
                  <Mail size={18} aria-hidden="true" /> Email
                </a>
                <button type="button" onClick={handleCopyLink} className="ne-focus flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-ne-ink hover:bg-[#1E1B20]">
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
          <div role="dialog" aria-modal="true" aria-label="Photo gallery" className="ne-root ne-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[85vh] max-w-md flex-col rounded-t-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold tracking-wide text-ne-ink">Gallery <span className="text-xs font-normal text-[#9C9186]">{gallery.gridImages.length} photos</span></h2>
              <button type="button" onClick={gallery.closeGrid} aria-label="Close gallery" className="ne-focus grid h-9 w-9 place-items-center rounded-full text-[#BDB4A8]"><X size={18} /></button>
            </div>
            <div ref={gallery.gridScrollRef} className="grid grid-cols-3 gap-2 overflow-y-auto">
              {gallery.gridImages.map((row, index) => (
                <figure key={`${row.url}-${index}`} className="min-w-0">
                  <button type="button" onClick={() => gallery.openGridImage(index)} aria-label={`Open photo ${index + 1} of ${gallery.gridImages.length}`} className="ne-focus aspect-square w-full overflow-hidden rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element -- customer gallery image */}
                    <img src={row.url} alt={`${name} gallery photo ${index + 1}`} width={300} height={300} loading="lazy" onError={(e) => onImgError(e, name)} className="h-full w-full object-cover" />
                  </button>
                  {row.caption ? <figcaption className="mt-0.5 line-clamp-1 text-[10px] text-[#9C9186]">{row.caption}</figcaption> : null}
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
            <button type="button" onClick={gallery.closeImage} aria-label="Close photo viewer" className="ne-focus absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-black/50 text-white"><X size={20} /></button>
            <button type="button" onClick={() => gallery.step(-1)} aria-label="Previous photo" className="ne-focus absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronLeft size={20} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element -- full-size customer image */}
            <img src={gallery.current.url} alt={`${name} gallery photo ${gallery.index + 1}`} className="max-h-full max-w-full rounded-lg object-contain" onError={(e) => onImgError(e, name)} />
            <button type="button" onClick={() => gallery.step(1)} aria-label="Next photo" className="ne-focus absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white"><ChevronRight size={20} /></button>
            {gallery.current.caption ? <p className="absolute bottom-5 left-1/2 max-w-[85%] -translate-x-1/2 text-center text-xs text-white">{gallery.current.caption}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

