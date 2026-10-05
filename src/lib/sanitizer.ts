import React from 'react';
import DOMPurify, { type Config as DOMPurifyConfig } from 'isomorphic-dompurify';

/**
 * HTML sanitisation for tenant-authored rich text.
 *
 * Every field that reaches `dangerouslySetInnerHTML` MUST pass through here
 * first. The allowlist is deliberately narrow: inline emphasis, paragraphs,
 * lists and links only. Anything not named is stripped, and event-handler
 * attributes are forbidden outright so no inline JS can survive.
 *
 * Note the defence-in-depth intent — this is the render-time gate. The
 * write-time gate is `sanitizeHtml` applied inside the Zod schemas
 * (`src/lib/validation/card.ts`), so stored data is already clean and this
 * layer catches anything that predates it or arrived via another path.
 */

export type SafeHtmlOptions = {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  addLinkTargetBlank?: boolean;
};

const DEFAULT_ALLOWED_TAGS = [
  'b',
  'i',
  'em',
  'strong',
  'a',
  'p',
  'br',
  'ul',
  'ol',
  'li',
];

const DEFAULT_ALLOWED_ATTR: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
};

/**
 * Elements that have no legitimate place in tenant-authored card copy and are
 * the usual vehicles for stored-XSS, clickjacking and data exfiltration.
 * Listed explicitly (in addition to the allowlist) so the intent is auditable
 * and so a future widening of the allowlist cannot silently re-admit them.
 */
const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
  'base',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
];

/** Inline event handlers — redundant with the allowlist, kept as explicit intent. */
const FORBIDDEN_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onfocus',
  'onblur',
  'onchange',
  'onsubmit',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onanimationstart',
  'ontransitionend',
];

export function sanitizeHtml(dirty: string, options: SafeHtmlOptions = {}): string {
  if (!dirty) return '';

  const allowedAttr = options.allowedAttributes ?? DEFAULT_ALLOWED_ATTR;

  const config = {
    ALLOWED_TAGS: options.allowedTags ?? DEFAULT_ALLOWED_TAGS,
    ALLOWED_ATTR: allowedAttr,
    RETURN_TRUSTED_TYPE: false,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTR,
    ADD_ATTR: ['target', 'rel'],
    FORCE_BODY: false,
    // dompurify's `Config` declares ALLOWED_ATTR as `string[]` only, but its
    // runtime contract also accepts the per-tag `{ tag: [attrs] }` map — which
    // is what we use so `<a>` gets href/target/rel without every other element
    // inheriting them. The cast bridges that known gap in the upstream types.
  } as unknown as DOMPurifyConfig;

  // The overload taking `cfg` is typed to return `TrustedHTML`; with
  // RETURN_TRUSTED_TYPE: false at runtime it is a plain string.
  const clean = DOMPurify.sanitize(dirty, config) as unknown as string;

  // Links open in a new tab without leaking the opener or the referrer.
  if (options.addLinkTargetBlank !== false) {
    return clean.replace(/<a\s+/gi, '<a target="_blank" rel="noopener noreferrer" ');
  }
  return clean;
}

export type SafeHtmlProps = {
  html: string;
  className?: string;
  options?: SafeHtmlOptions;
};

/**
 * Drop-in replacement for a raw `dangerouslySetInnerHTML` render of tenant
 * HTML. Prefer this component over hand-rolled sanitisation at the call site.
 */
export function SafeHtml({ html, className, options }: SafeHtmlProps) {
  const clean = sanitizeHtml(html, options);
  return React.createElement('div', { className, dangerouslySetInnerHTML: { __html: clean } });
}