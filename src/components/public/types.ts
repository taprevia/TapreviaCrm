/**
 * Public Card component type surface.
 *
 * Thin re-export layer over the canonical contracts in `@/types` plus a few
 * convenience aliases used by the public components.
 */

export type {
  IVcard,
  IProduct,
  IBusinessHour,
  ISocialLink,
  IVcardBanner,
  IVcardConfig,
  ISectionFlags,
  TemplateKey as VcardTemplateKey,
  DayOfWeek as Weekday,
} from '@/types';

export type IVcardBasicInfo = import('@/types').IVcard['basic'];
export type IVcardLocation = import('@/types').IVcard['location'];
export type IVcardSections = import('@/types').ISectionFlags;
export type IVcardStats = import('@/types').IVcard['stats'];

/**
 * Server-derived CTA descriptor passed from the public page into templates.
 * It carries only a resolved internal href — never entitlement or settings
 * flags — so templates cannot widen access on the client.
 */
export interface ReviewCta {
  href: string;
}
