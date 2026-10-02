'use client';

/**
 * Basic tab — identity fields, contact row and the public URL alias picker.
 *
 * Note: `website` has no dedicated field on ICard.basic; publicly it is the
 * `socialLinks` row whose platform is website-ish (see public/template-registry.tsx
 * websiteHref). This tab therefore reads/writes that row so the builder matches
 * what actually renders.
 */

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';

/* Same rule as aliasSchema / check-alias ALIAS_FORMAT_RE — client-side
 * pre-validation avoids pointless network probes for obviously bad input. */
const ALIAS_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

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

type AliasStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; suggestion?: string }
  | { kind: 'reserved' }
  | { kind: 'invalid' };

interface BasicTabProps {
  cardId: string;
}

export function BasicTab({ cardId }: BasicTabProps) {
  const { draft, setField } = useBuilder();
  const basic = draft.basic;

  /* ── URL alias ── */
  // null ⇒ untouched; render the persisted alias instead of an empty box.
  const [aliasInput, setAliasInput] = useState<string | null>(null);
  const [status, setStatus] = useState<AliasStatus>({ kind: 'idle' });
  const loadedAliasRef = useRef(draft.urlAlias);

  useEffect(() => {
    loadedAliasRef.current = draft.urlAlias;
  }, [draft.urlAlias]);

  const aliasValue = aliasInput ?? loadedAliasRef.current ?? '';

  useEffect(() => {
    const candidate = aliasValue.trim().toLowerCase();
    const baseline = (loadedAliasRef.current ?? '').trim().toLowerCase();

    if (!candidate || candidate === baseline) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (!ALIAS_RE.test(candidate)) {
      setStatus({ kind: 'invalid' });
      return;
    }

    setStatus({ kind: 'checking' });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/cards/check-alias?alias=${encodeURIComponent(candidate)}&excludeId=${encodeURIComponent(cardId)}`,
          { signal: controller.signal }
        );
        const data = (await res.json().catch(() => null)) as
          | { available?: boolean; suggestion?: string; reason?: string }
          | null;
        if (!res.ok || !data) throw new Error('alias check failed');
        if (data.available) setStatus({ kind: 'available' });
        else if (data.reason === 'RESERVED') setStatus({ kind: 'reserved' });
        else setStatus({ kind: 'taken', suggestion: data.suggestion });
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') setStatus({ kind: 'idle' });
      }
    }, 500);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [aliasValue, cardId]);

  // Persist only a valid, changed alias — autosave picks it up like any field.
  useEffect(() => {
    if (status.kind !== 'available') return;
    const candidate = aliasValue.trim().toLowerCase();
    if (candidate && candidate !== draft.urlAlias) setField('urlAlias', candidate);
  }, [status.kind, aliasValue, draft.urlAlias, setField]);

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

      {/* ── Public URL alias ── */}
      <div>
        <label htmlFor="basic-urlAlias" className="mb-1.5 block text-sm font-medium text-ink-mute">
          Profile URL
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 select-none text-sm text-ink-faint"
          >
            /profile/
          </span>
          <Input
            id="basic-urlAlias"
            className={cn(darkInput, 'pl-[4.6rem] font-mono text-[13px]')}
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
            value={aliasValue}
            onChange={(event) => setAliasInput(event.target.value)}
            aria-describedby="basic-urlAlias-status"
          />
        </div>
        <p id="basic-urlAlias-status" className="mt-1.5 flex min-h-[1.25rem] items-center gap-1.5 text-xs" aria-live="polite">
          {status.kind === 'checking' && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" aria-hidden="true" />
              <span className="text-ink-faint">Checking availability…</span>
            </>
          )}
          {status.kind === 'available' && (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span className="text-emerald-400">Available</span>
            </>
          )}
          {status.kind === 'taken' && (
            <>
              <X className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
              <span className="text-red-400">Taken</span>
              {status.suggestion && (
                <button
                  type="button"
                  onClick={() => setAliasInput(status.suggestion!)}
                  className="ml-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 font-mono text-[11px] text-ink-mute transition-colors hover:border-accent-500 hover:text-accent-400"
                >
                  Use “{status.suggestion}”
                </button>
              )}
            </>
          )}
          {status.kind === 'reserved' && (
            <>
              <X className="h-3.5 w-3.5 text-red-400" aria-hidden="true" />
              <span className="text-red-400">This alias is reserved</span>
            </>
          )}
          {status.kind === 'invalid' && (
            <span className="text-warn">
              3–40 characters: lowercase letters, numbers, hyphens (no leading/trailing hyphen)
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
