import type { ReactNode } from 'react';
import { NewsletterPopup } from './newsletter-popup';
import { StickyDock } from './sticky-dock';
import { PanthiEventTemplate } from './templates/panthi-event';
import { ProfessionalProfileTemplate } from './templates/professional-profile';
import { SocialTemplate } from './templates/social';
import { PremiumPurpleTemplate } from './templates/premium-purple';
import type { IProduct, IVcard, ReviewCta } from './types';
import { DEFAULT_TEMPLATE_KEY, safeTemplateKey } from '@/lib/card-templates';

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/** Sections flags: undefined ⇒ shown; only explicit false hides. */
const sectionOn = (flag: boolean | undefined): boolean => flag !== false;

/** Accept only the internal, alias-encoded href produced by the public page. */
function safeReviewCta(cta: ReviewCta | undefined): ReviewCta | undefined {
  if (!cta || typeof cta.href !== 'string') return undefined;
  const alias = cta.href.startsWith('/review/') ? cta.href.slice('/review/'.length) : '';
  if (alias === '.' || alias === '..') return undefined;
  return /^\/review\/[A-Za-z0-9._~%!*'()-]+$/.test(cta.href) ? cta : undefined;
}

/* ------------------------------------------------------------------ */
/* Public renderer                                                     */
/* ------------------------------------------------------------------ */

export function PublicVcardRenderer({
  vcard,
  products,
  newsletterDelaySeconds = 8,
  newsletterEnabled = true,
  reviewCta,
}: {
  vcard: IVcard;
  products: IProduct[];
  newsletterDelaySeconds?: number;
  newsletterEnabled?: boolean;
  reviewCta?: ReviewCta;
}) {
  const activeProducts = (products ?? []).filter((p) => p.active);
  const cta = safeReviewCta(reviewCta);

  const TemplateComponent =
    CARD_TEMPLATES[safeTemplateKey(vcard.templateKey) as keyof typeof CARD_TEMPLATES] ??
    CARD_TEMPLATES[DEFAULT_TEMPLATE_KEY];

  return (
    <div className="mx-auto w-full max-w-md">
      <TemplateComponent vcard={vcard} products={activeProducts} reviewCta={cta} />
      {!vcard.config?.hideStickyBar && <StickyDock vcard={vcard} />}
      {sectionOn(vcard.sections?.newsletterPopup) && (
        <NewsletterPopup
          alias={vcard.urlAlias}
          enabled={newsletterEnabled}
          delaySeconds={newsletterDelaySeconds}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Registry — add new TSX templates here                              */
/* ------------------------------------------------------------------ */

export const CARD_TEMPLATES = {
  'panthi-event': PanthiEventTemplate,
  'professional-profile': ProfessionalProfileTemplate,
  social: SocialTemplate,
  'premium-purple': PremiumPurpleTemplate,
} as const satisfies Record<
  string,
  (props: { vcard: IVcard; products: IProduct[]; reviewCta?: ReviewCta }) => ReactNode
>;