'use client';

/**
 * Social Destination tab — configuration for "social card" experiences.
 *
 * A social card has no profile page: tapping or scanning it sends the visitor
 * to the redirect destination URL. The card's printed NFC/QR URL is stable —
 * changing the destination never changes what's printed on the card.
 */

import { ExternalLink } from 'lucide-react';
import { Badge, Input } from '@/components/ui';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

export function SocialDestinationTab() {
  const { draft, setField } = useBuilder();

  const kind = draft.kind ?? 'profile';
  const isActive = draft.isActive === true;
  const redirectUrl = draft.redirectUrl ?? '';

  const trimmed = redirectUrl.trim();
  const invalid = trimmed.length > 0 && !/^https?:\/\//i.test(trimmed);


  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-subtle bg-bg p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Social card</p>
          <p className="text-xs text-ink-mute">
            No profile page — every tap sends the visitor to your destination.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={isActive ? 'success' : 'default'}>{isActive ? 'Active' : 'Suspended'}</Badge>
          <Badge variant="info">{kind}</Badge>
        </div>
      </div>

      <div className="min-w-0">
        <label htmlFor="social-redirect-url" className="mb-1.5 block text-sm font-medium text-ink-mute">
          Destination URL
        </label>
        <Input
          id="social-redirect-url"
          className={cn(darkInput, invalid && 'border-warn/70 focus:border-warn focus:ring-warn/25')}
          placeholder="https://linktr.ee/your-profile"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={redirectUrl}
          onChange={(event) => setField('redirectUrl', event.target.value)}
        />
        <p className={cn('mt-1.5 text-xs', invalid ? 'text-warn' : 'text-ink-faint')}>
          {invalid
            ? 'URL must start with http(s):// — fix it, then press Save to retry.'
            : 'Where this card sends visitors when it’s tapped or scanned.'}
        </p>
      </div>

      <div className="rounded-xl border border-line-subtle bg-bg p-4">
        <p className="mb-2 text-sm font-medium text-ink-mute">Public experience</p>
        <p className="text-xs leading-relaxed text-ink-faint">
          Visitors are sent directly to your saved destination. The permanent NFC/QR
          link printed on the physical product is managed by Taprevia admin.
        </p>
        {trimmed && !invalid && (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent-400 hover:text-accent-300"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            Open destination
          </a>
        )}
      </div>
    </div>
  );
}