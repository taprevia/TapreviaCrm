import {
  Activity,
  ArrowLeftRight,
  Copy,
  Download,
  ExternalLink,
  MousePointerClick,
  Send,
  Share2,
  ShoppingBag,
  Star,
  Wand2,
  type LucideIcon,
} from 'lucide-react';

export interface ActionMeta {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
}

/** Canonical tile order; anything else is appended alphabetically. */
const CANONICAL_ORDER = [
  'tap',
  'vcard_download',
  'link_click',
  'form_submit',
  'exchange',
  'product_enquiry',
  'share',
  'social_redirect',
  'review_page_view',
  'review_started',
  'review_generated',
  'review_copied',
  'review_google_clicked',
  'review_suggestions_shown',
  'review_template_used',
] as const;

const ACTION_META: Record<string, ActionMeta> = {
  tap: { label: 'Card taps', icon: MousePointerClick, iconClassName: 'bg-accent-600/10 text-accent-400' },
  vcard_download: { label: 'vCard downloads', icon: Download, iconClassName: 'bg-ok/10 text-ok' },
  link_click: { label: 'Link clicks', icon: ExternalLink, iconClassName: 'bg-violet-500/10 text-violet-400' },
  form_submit: { label: 'Form submissions', icon: Send, iconClassName: 'bg-sky-500/10 text-sky-400' },
  exchange: { label: 'Exchanges', icon: ArrowLeftRight, iconClassName: 'bg-warn/10 text-warn' },
  product_enquiry: { label: 'Product enquiries', icon: ShoppingBag, iconClassName: 'bg-pink-500/10 text-pink-400' },
  share: { label: 'Shares', icon: Share2, iconClassName: 'bg-fuchsia-500/10 text-fuchsia-400' },
  social_redirect: { label: 'Social redirects', icon: ExternalLink, iconClassName: 'bg-sky-500/10 text-sky-400' },
  review_page_view: { label: 'Review page views', icon: Star, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_started: { label: 'Reviews started', icon: Wand2, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_generated: { label: 'Review drafts generated', icon: Send, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_copied: { label: 'Review drafts copied', icon: Copy, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_google_clicked: { label: 'Continue to Google clicked', icon: ExternalLink, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_suggestions_shown: { label: 'Template suggestions shown', icon: Wand2, iconClassName: 'bg-amber-500/10 text-amber-400' },
  review_template_used: { label: 'Template suggestion selected', icon: Copy, iconClassName: 'bg-amber-500/10 text-amber-400' },
};

function prettifyAction(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Metadata for a known action, or a neutral fallback for unknown keys. */
export function metaForAction(action: string): ActionMeta {
  return (
    ACTION_META[action] ?? {
      label: prettifyAction(action),
      icon: Activity,
      iconClassName: 'bg-field text-ink-mute',
    }
  );
}

/** Totals keys in canonical order, unknown keys appended alphabetically. */
export function orderedActions(totals: Record<string, number>): string[] {
  const known = CANONICAL_ORDER.filter((action) => action in totals);
  const knownSet = new Set<string>(CANONICAL_ORDER);
  const unknown = Object.keys(totals)
    .filter((key) => !knownSet.has(key))
    .sort();
  return [...known, ...unknown];
}
