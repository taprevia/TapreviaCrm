'use client';

/**
 * Basic tab — identity fields, contact row and the immutable public URL.
 *
 * Note: `website` has no dedicated field on ICard.basic; publicly it is the
 * `socialLinks` row whose platform is website-ish (see public/template-registry.tsx
 * websiteHref). This tab therefore reads/writes that row so the builder matches
 * what actually renders.
 *
 * The public URL is assigned once during creation and is read-only here. No
 * profile-content edit can change it.
 */

import { useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';
import { canonicalPublicBase } from '@/lib/public-base';
import { resolveCustomerPublicPath } from '@/lib/services/customer-public-url';

const WEBSITE_PLATFORMS = new Set(['website', 'site', 'web', 'blog', 'portfolio']);

/** Dark-token overrides for the light-skinned ui/Input. */
const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-mute">
        {label}
      </label>
      {children}
    </div>
  );
}

export function BasicTab() {
  const { draft, setField } = useBuilder();
  const basic = draft.basic;
  const publicPath = resolveCustomerPublicPath(draft);
  const publicBase = canonicalPublicBase().replace(/\/+$/, '');
  const publicUrl = publicPath ? (publicBase ? `${publicBase}${publicPath}` : publicPath) : '';

  /* ── Immutable public URL ── */
  const [copied, setCopied] = useState(false);
  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* Clipboard may be unavailable; the URL is still visible. */
    }
  };

  /* ── Website row inside socialLinks ── */
  const websiteRow = (draft.socialLinks ?? []).find((link) =>
    WEBSITE_PLATFORMS.has(link.platform.toLowerCase())
  );
  const websiteUrl = websiteRow?.url?.trim().replace(/^https?:\/\//i, '') ?? '';

  const handleWebsiteChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value.trim();
    const url = raw === '' ? '' : (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const links = draft.socialLinks ?? [];
    const index = links.findIndex((link) => WEBSITE_PLATFORMS.has(link.platform.toLowerCase()));

    if (index === -1) {
      if (url === '') return;
      setField('socialLinks', [...links, { platform: 'website', url }]);
      return;
    }
    if (url === '') {
      // Dropping the value removes the placeholder row entirely.
      setField(
        'socialLinks',
        links.filter((_, i) => i !== index)
      );
      return;
    }
    setField(
      'socialLinks',
      links.map((link, i) => (i === index ? { ...link, url } : link))
    );
  };

  const bindBasic = (key: keyof typeof basic) => ({
    value: basic[key] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setField(`basic.${key}`, event.target.value),
  });

  const bindNamePart = (key: 'firstName' | 'lastName') => ({
    value: basic[key] ?? '',
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setField(`basic.${key}`, value);
      const firstName = (key === 'firstName' ? value : basic.firstName ?? '').trim();
      const lastName = (key === 'lastName' ? value : basic.lastName ?? '').trim();
      const combined = [firstName, lastName].filter(Boolean).join(' ').trim();
      // vcardDisplayName() prefers the top-level `name`, so keep it derived
      // from first + last to avoid a stale name overriding builder edits.
      if (combined) setField('name', combined);
    },
  });

  return (
    <div className="space-y-5">
      <Field label="Card label" htmlFor="basic-cardLabel">
        <Input
          id="basic-cardLabel"
          maxLength={80}
          placeholder="e.g. Sam — Sales Director"
          className={darkInput}
          value={draft.cardLabel ?? ''}
          onChange={(event) => setField('cardLabel', event.target.value)}
        />
        <p className="mt-1.5 text-xs text-ink-faint">
          Used to name this card in your dashboard. Leave blank to use the name above.
        </p>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="basic-firstName">
          <Input id="basic-firstName" maxLength={80} autoComplete="given-name" className={darkInput} {...bindNamePart('firstName')} />
        </Field>
        <Field label="Last name" htmlFor="basic-lastName">
          <Input id="basic-lastName" maxLength={80} autoComplete="family-name" className={darkInput} {...bindNamePart('lastName')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="basic-jobTitle">
          <Input id="basic-jobTitle" maxLength={120} className={darkInput} {...bindBasic('jobTitle')} />
        </Field>
        <Field label="Company" htmlFor="basic-company">
          <Input id="basic-company" maxLength={120} className={darkInput} {...bindBasic('company')} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Phone" htmlFor="basic-phone">
          <Input id="basic-phone" type="tel" maxLength={20} autoComplete="tel" className={darkInput} {...bindBasic('phone')} />
        </Field>
        <Field label="Email" htmlFor="basic-email">
          <Input id="basic-email" type="email" maxLength={255} autoComplete="email" className={darkInput} {...bindBasic('email')} />
        </Field>
        <Field label="Website" htmlFor="basic-website">
          <Input
            id="basic-website"
            type="text"
            inputMode="url"
            placeholder="example.com"
            className={darkInput}
            value={websiteUrl}
            onChange={handleWebsiteChange}
          />
        </Field>
      </div>

      {/* ── Public URL (immutable) ── */}
      <Field label="Public URL" htmlFor="basic-urlAlias">
        <div className="flex items-center gap-2">
          <Input
            id="basic-urlAlias"
            className={cn(darkInput, 'min-w-0 flex-1 cursor-default font-mono text-[13px]')}
            spellCheck={false}
            autoComplete="off"
            value={publicUrl}
            readOnly
            aria-readonly="true"
            aria-describedby="basic-urlAlias-help"
            placeholder="Public URL unavailable"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyPublicUrl}
            disabled={!publicUrl}
            title="Copy public URL"
            aria-label="Copy public URL"
          >
            {copied ? <Check className="h-4 w-4 text-ok" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
        <p id="basic-urlAlias-help" className="mt-1.5 text-xs text-ink-faint">
          Assigned when this card was created. This public URL cannot be changed.
        </p>
      </Field>
    </div>
  );
}
