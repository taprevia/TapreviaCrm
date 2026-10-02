import type { ReactNode } from 'react';
import { NewsletterPopup } from './newsletter-popup';
import { StickyDock } from './sticky-dock';
import { PanthiEventTemplate } from './templates/panthi-event';
import { ProfessionalProfileTemplate } from './templates/professional-profile';
import { SocialTemplate } from './templates/social';
import type { IProduct, IVcard } from './types';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/** Sections flags: undefined ⇒ shown; only explicit false hides. */
const sectionOn = (flag: boolean | undefined): boolean => flag !== false;

/* ------------------------------------------------------------------ */
/* Public renderer                                                     */
/* ------------------------------------------------------------------ */

export function PublicVcardRenderer({
  vcard,
  products,
  newsletterDelaySeconds = 8,
  newsletterEnabled = true,
}: {
  vcard: IVcard;
  products: IProduct[];
  newsletterDelaySeconds?: number;
  newsletterEnabled?: boolean;
}) {
  const activeProducts = (products ?? []).filter((p) => p.active);

  const TemplateComponent =
    CARD_TEMPLATES[vcard.templateKey as keyof typeof CARD_TEMPLATES] ??
    CARD_TEMPLATES[DEFAULT_TEMPLATE_KEY];

  return (
    <div className="mx-auto w-full max-w-md">
      <TemplateComponent vcard={vcard} products={activeProducts} />
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
} as const satisfies Record<
  string,
  (props: { vcard: IVcard; products: IProduct[] }) => ReactNode
>;