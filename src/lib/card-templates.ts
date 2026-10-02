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

export interface CardTemplateMeta {
  key: string;
  name: string;
  description: string;
}

export const CARD_TEMPLATE_META: readonly CardTemplateMeta[] = [
  {
    key: 'panthi-event',
    name: 'Panthi Event',
    description:
      'Event-focused card with hero cover, product carousel, services list, gallery, WhatsApp pricing enquiry and contact sheet.',
  },
  {
    key: 'professional-profile',
    name: 'Professional Profile',
    description:
      'Premium digital contact card — cover banner, logo identity, quick actions, product & service catalog, gallery and WhatsApp enquiry.',
  },
  {
    key: 'social',
    name: 'Social',
    description:
      'Modern glassmorphic profile card layout with cover banner, circular overlapping avatar, quick contact actions, and dynamic brand links.',
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

export function isDefaultTemplateKey(key: string | undefined | null): boolean {
  return typeof key === 'string' && DEFAULT_ALLOWED_TEMPLATES.includes(key);
}

/** Fallback display name for a key (default catalog name, else the key). */
export function defaultTemplateName(key: string): string {
  return CARD_TEMPLATE_META.find((t) => t.key === key)?.name ?? key;
}