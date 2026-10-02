'use client';

/**
 * PreviewPanel — renders the actual template selected by `draft.templateKey`
 * (from the public CARD_TEMPLATES registry) inside a `.vcard-root` theme scope,
 * so the builder preview matches the live public page.
 *
 * Products are loaded from /api/cards/[id]/products so product-backed templates
 * (panthevent carousel) preview faithfully. Fixed overlays (StickyDock,
 * NewsletterPopup) are intentionally not rendered — they don't belong to a
 * template's layout.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import type { IVcard, IProduct } from '@/components/public/types';
import { CARD_TEMPLATES } from '@/components/public/template-registry';
import type { CardDraft } from '@/lib/hooks/use-card-draft';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

/* ─── Colour helpers (shared with theme-tab / match public-card-page) ───────── */

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match?.[1]) return null;
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Sensible text colour for content sitting on `bgHex`; invalid hex ⇒ light. */
export function readableOn(bgHex: string): string {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#FFFFFF';
  return relativeLuminance(rgb) > 0.35 ? '#111827' : '#FFFFFF';
}

/** Slightly shifted companion surface for a given background colour. */
function companionSurface(bgHex: string): string {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#F1F5F9';
  return relativeLuminance(rgb) > 0.35 ? '#F1F5F9' : '#1E293B';
}

/** Relative luminance of a hex colour; invalid/none ⇒ light (1). */
function luminanceHex(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? relativeLuminance(rgb) : 1;
}

/* ─── Identity helper (used by builder-shell header) ────────────────────────── */

export function vcardDisplayName(draft: CardDraft): string {
  const top = draft.name?.trim();
  if (top) return top;
  const first = draft.basic?.firstName?.trim() ?? '';
  const last = draft.basic?.lastName?.trim() ?? '';
  return `${first} ${last}`.trim() || 'Profile';
}

/* ─── Component ─────────────────────────────────────────────────────────────── */

interface PreviewPanelProps {
  draft: CardDraft;
}

export function PreviewPanel({ draft }: PreviewPanelProps) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(draft.themeConfig?.accentColor ?? '')
    ? draft.themeConfig.accentColor
    : '#2563EB';
  const bg = /^#[0-9a-fA-F]{6}$/.test(draft.themeConfig?.bgColor ?? '')
    ? draft.themeConfig.bgColor
    : '#FFFFFF';

  /* Same var computation as public-card-page: dark backgrounds also override
     the surface/text/muted/border tokens, otherwise .vcard-root defaults apply. */
  const isDarkBg = luminanceHex(bg) < 0.18;
  const vars = {
    '--v-bg': bg,
    '--v-accent': accent,
    '--v-on-accent': luminanceHex(accent) > 0.45 ? '#0B0F19' : '#FFFFFF',
    '--v-surface': companionSurface(bg),
    ...(isDarkBg
      ? {
          '--v-text': '#F8FAFC',
          '--v-muted': '#94A3B8',
          '--v-border': '#334155',
        }
      : {}),
  } as CSSProperties;

  const vcard = draft as unknown as IVcard;
  const TemplateComponent =
    CARD_TEMPLATES[draft.templateKey as keyof typeof CARD_TEMPLATES] ??
    CARD_TEMPLATES[DEFAULT_TEMPLATE_KEY];

  /* Products are a standalone resource; fetch so product-backed templates render. */
  const [products, setProducts] = useState<IProduct[]>([]);
  const [productsReloadKey, setProductsReloadKey] = useState(0);

  useEffect(() => {
    const onProductsChanged = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (Array.isArray(detail)) setProducts(detail as IProduct[]);
      setProductsReloadKey((k) => k + 1);
    };
    window.addEventListener('builder:products-changed', onProductsChanged);
    return () => window.removeEventListener('builder:products-changed', onProductsChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setProducts([]);
    fetch(`/api/cards/${draft._id}/products?page=1&limit=100`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { items?: IProduct[] } | null) => {
        if (!cancelled && data?.items) setProducts(data.items);
      })
      .catch(() => {
        /* preview stays product-less on failure */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [draft._id, productsReloadKey]);

  return (
    <div>
      <div className="overflow-hidden rounded-2xl bg-bg-raised shadow-e3 ring-1 ring-line-subtle">
        <div className="vcard-root max-h-[560px] overflow-y-auto" style={vars}>
          <div className="mx-auto w-full max-w-md">
            <TemplateComponent vcard={vcard} products={products} />
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-ink-faint">
        Live preview — updates as you type
      </p>
    </div>
  );
}