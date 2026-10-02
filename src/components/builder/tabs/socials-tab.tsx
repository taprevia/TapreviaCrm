'use client';

/**
 * Socials tab — repeatable link rows.
 *
 * Platform keys mirror public/socials-row.tsx BrandIcon cases exactly, so
 * whatever is picked here renders with the matching brand glyph publicly.
 * Rows are stored as ISocialLink[]; incomplete rows stay editable in the draft
 * and are dropped from PATCH payloads by the draft hook's sanitizer.
 */

import { useEffect, useState, type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Lock } from 'lucide-react';
import type { ISocialLink } from '@/types';
import { Input, Select } from '@/components/ui';
import { useBuilder } from '../context';
import { DEFAULT_SOCIAL_LINKS_MAX } from '@/lib/feature-keys';

/** Same key set socials-row.tsx's BrandIcon switch handles. */
const PLATFORM_OPTIONS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'x', label: 'X (Twitter)' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'tumblr', label: 'Tumblr' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'website', label: 'Website' },
];

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

export function SocialsTab() {
  const { draft, setField } = useBuilder();
  const links = draft.socialLinks ?? [];

  // Product feature gate: limit = the customer's configured social-links max
  // (fallback DEFAULT_SOCIAL_LINKS_MAX while loading). Server enforces too.
  const [socialMax, setSocialMax] = useState<number | undefined>(DEFAULT_SOCIAL_LINKS_MAX);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/my/features');
        if (res.ok) {
          const data = await res.json();
          const social = data?.features?.social;
          setAllowed(social?.enabled === true);
          setSocialMax(social?.max ?? DEFAULT_SOCIAL_LINKS_MAX);
          return;
        }
      } catch (error) {
        console.error('Failed to fetch social feature:', error);
      }
      setAllowed(true);
    })();
  }, []);

  const maxLinks = socialMax ?? DEFAULT_SOCIAL_LINKS_MAX;

  if (allowed === false) {
    return (
      <div className="rounded-lg bg-surface px-4 py-8 text-center ring-1 ring-line-subtle">
        <Lock className="mx-auto mb-3 h-6 w-6 text-ink-faint" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">Social links not included</p>
        <p className="mt-1 text-sm text-ink-faint">
          Your current products don&apos;t include social links. Contact Taprevia to upgrade.
        </p>
      </div>
    );
  }

  const update = (next: ISocialLink[]) => setField('socialLinks', next);

  const updateRow = (index: number, patch: Partial<ISocialLink>) => {
    update(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= links.length) return;
    const next = [...links];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    update(next);
  };

  const removeRow = (index: number) => {
    update(links.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (links.length >= maxLinks) return;
    // Default to a platform that isn't used yet so rows start meaningful.
    const used = new Set(links.map((link) => link.platform));
    const firstFree = PLATFORM_OPTIONS.find((option) => !used.has(option.value));
    update([...links, { platform: firstFree?.value ?? 'website', url: '' }]);
  };

  return (
    <div className="space-y-3">
      {links.length === 0 && (
        <p className="rounded-lg bg-surface px-3 py-6 text-center text-sm text-ink-faint ring-1 ring-line-subtle">
          No links yet — add your first one below.
        </p>
      )}

      {links.map((link, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg bg-surface p-3 ring-1 ring-line-subtle"
        >
          <div className="flex items-start gap-2">
            <Select
              aria-label={`Platform for row ${index + 1}`}
              className="w-36 shrink-0"
              options={PLATFORM_OPTIONS}
              value={link.platform || PLATFORM_OPTIONS[0]!.value}
              onChange={(value) => updateRow(index, { platform: value })}
            />
            <Input
              aria-label={`URL for ${link.platform || 'link'} row ${index + 1}`}
              type="text"
              inputMode="url"
              placeholder="https://…"
              className={`min-w-0 flex-1 ${darkInput}`}
              value={link.url}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateRow(index, { url: event.target.value })
              }
            />
          </div>
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label={`Move ${link.platform || 'row'} ${index + 1} up`}
              title="Move up"
              disabled={index === 0}
              onClick={() => moveRow(index, -1)}
              className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Move ${link.platform || 'row'} ${index + 1} down`}
              title="Move down"
              disabled={index === links.length - 1}
              onClick={() => moveRow(index, 1)}
              className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${link.platform || 'row'} ${index + 1}`}
              title="Delete"
              onClick={() => removeRow(index)}
              className="grid h-7 w-7 place-items-center rounded-md text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={links.length >= maxLinks}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2.5 text-sm font-medium text-ink-mute transition-colors hover:border-accent-500 hover:text-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:pointer-events-none disabled:opacity-40 sm:w-auto sm:px-6"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add link
        </button>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {links.length}/{maxLinks}
        </span>
      </div>
    </div>
  );
}
