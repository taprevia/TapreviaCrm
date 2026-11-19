/**
 * Code-registered card template catalog.
 *
 * Templates are TSX components registered in `CARD_TEMPLATES` in
 * `src/components/public/template-registry.tsx`. This module is the
 * component-free, server/client-safe metadata side — API routes and UI
 * pickers consume it to describe available card templates.
 *
 * Display names can be overridden per-key by an admin (stored in DB via
 * `src/lib/services/template-names.ts`). When no override exists the
 * `name` below is used; unknown keys fall back to the key itself.
 */

export interface CardThemeDefaults {
  /** Stored in the existing Card.themeConfig.accentColor field. */
  readonly accentColor: string;
  /** Stored in the existing Card.themeConfig.bgColor field. */
  readonly bgColor: string;
}

export interface CardTemplateMeta {
  key: string;
  name: string;
  description: string;
  /**
   * Registered native palette. This is the single source of truth used when a
   * user explicitly switches templates. It never changes saved Card colours.
   */
  defaultTheme: CardThemeDefaults;
}

export const CARD_TEMPLATE_META: readonly CardTemplateMeta[] = [
  {
    key: 'panthi-event',
    name: 'Panthi Event',
    description:
      'Event-focused card with hero cover, product carousel, services list, gallery, WhatsApp pricing enquiry and contact sheet.',
    defaultTheme: { accentColor: '#10B981', bgColor: '#F6F7F9' },
  },
  {
    key: 'professional-profile',
    name: 'Professional Profile',
    description:
      'Premium digital contact card — cover banner, logo identity, quick actions, product & service catalog, gallery and WhatsApp enquiry.',
    defaultTheme: { accentColor: '#059669', bgColor: '#FFFFFF' },
  },
  {
    key: 'social',
    name: 'Social',
    description:
      'Modern glassmorphic profile card layout with cover banner, circular overlapping avatar, quick contact actions, and dynamic brand links.',
    defaultTheme: { accentColor: '#4F46E5', bgColor: '#0F172A' },
  },
  {
    key: 'premium-purple',
    name: 'Royal Aura',
    description:
      'A luxurious digital business profile with royal purple gradients, elegant gold waves, and a modern premium layout.',
    defaultTheme: { accentColor: '#7025BA', bgColor: '#FFFFFF' },
  },
  {
    key: 'noir-elite',
    name: 'Noir Elite',
    description:
      'A premium black-and-copper profile with a clean curved cover, elegant serif headings, dark-glass sections, and refined metallic accents.',
    defaultTheme: { accentColor: '#C08A4A', bgColor: '#0B0B0D' },
  },
  {
    key: 'emerald-essence',
    name: 'Emerald Essence',
    description:
      'A premium botanical profile with a customer cover image, ivory gold-edged curve, permanent decorative leaves, emerald typography and refined cards.',
    defaultTheme: { accentColor: '#065F46', bgColor: '#FFF9F0' },
  },
];

/** Template customers get when a card has no explicit templateKey yet. */
export const DEFAULT_TEMPLATE_KEY = 'panthi-event' as const;

/** Templates a customer can use when no explicit grant has been set. */
export const DEFAULT_ALLOWED_TEMPLATES: readonly string[] = CARD_TEMPLATE_META.map((t) => t.key);

const REGISTERED_KEYS: ReadonlySet<string> = new Set(CARD_TEMPLATE_META.map((t) => t.key));

export function isRegisteredTemplate(key: string | undefined | null): key is string {
  return typeof key === 'string' && REGISTERED_KEYS.has(key);
}

export function safeTemplateKey(key: string | undefined | null, fallback = DEFAULT_TEMPLATE_KEY): string {
  return isRegisteredTemplate(key) ? key : fallback;
}

const THEME_HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidThemeDefaults(value: CardThemeDefaults | undefined): value is CardThemeDefaults {
  return (
    !!value &&
    THEME_HEX_RE.test(value.accentColor) &&
    THEME_HEX_RE.test(value.bgColor)
  );
}

/**
 * Registered native palette for a template, or null when the palette is
 * missing/invalid. Null means callers must NOT guess or overwrite saved
 * colours; the incomplete metadata should be reported instead.
 */
export function defaultThemeForTemplate(key: string | undefined | null): CardThemeDefaults | null {
  if (!isRegisteredTemplate(key)) return null;
  const theme = CARD_TEMPLATE_META.find((template) => template.key === key)?.defaultTheme;
  if (!isValidThemeDefaults(theme)) return null;
  return { accentColor: theme.accentColor, bgColor: theme.bgColor };
}

/**
 * Pure draft update for an explicit template switch. Same-template selections
 * and templates without complete metadata return null, so existing custom
 * colours are never reset and no unnecessary save is triggered.
 */
export function resolveTemplateThemeChange(
  currentKey: string | undefined | null,
  nextKey: string | undefined | null,
): { templateKey: string; themeConfig: CardThemeDefaults } | null {
  if (!nextKey || nextKey === currentKey) return null;
  const themeConfig = defaultThemeForTemplate(nextKey);
  if (!themeConfig) return null;
  return { templateKey: nextKey, themeConfig };
}

export function isDefaultTemplateKey(key: string | undefined | null): boolean {
  return typeof key === 'string' && DEFAULT_ALLOWED_TEMPLATES.includes(key);
}

/** Fallback display name for a key (default catalog name, else the key). */
export function defaultTemplateName(key: string): string {
  return CARD_TEMPLATE_META.find((t) => t.key === key)?.name ?? key;
}