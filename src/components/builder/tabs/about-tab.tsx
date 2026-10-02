'use client';

/** About tab — occupation + rich-ish description with a character counter. */

import type { ChangeEvent } from 'react';
import { Input } from '@/components/ui/input';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

const ABOUT_MAX = 1000;

export function AboutTab() {
  const { draft, setField } = useBuilder();
  const about = draft.descriptionHtml ?? '';
  const remaining = ABOUT_MAX - about.length;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="about-occupation" className="mb-1.5 block text-sm font-medium text-ink-mute">
          Occupation
        </label>
        <Input
          id="about-occupation"
          maxLength={120}
          placeholder="e.g. Product Designer"
          className={darkInput}
          value={draft.occupation ?? ''}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            setField('occupation', event.target.value)
          }
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <label htmlFor="about-description" className="block text-sm font-medium text-ink-mute">
            About
          </label>
          <span
            className={cn(
              'text-xs tabular-nums',
              remaining <= 0 ? 'text-red-400' : 'text-ink-faint'
            )}
          >
            {about.length}/{ABOUT_MAX}
          </span>
        </div>
        <textarea
          id="about-description"
          rows={5}
          maxLength={ABOUT_MAX}
          className={cn(
            'w-full rounded-lg border border-line bg-field px-3 py-2.5 text-sm text-ink',
            'placeholder:text-ink-faint transition-colors duration-200',
            'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25',
            'hover:border-line-strong'
          )}
          value={about}
          onChange={(event) => setField('descriptionHtml', event.target.value)}
          aria-describedby="about-counter"
        />
        <p id="about-counter" className="mt-1 text-right text-xs text-ink-faint">
          Shown on your public profile — plain text or simple HTML.
        </p>
      </div>
    </div>
  );
}
