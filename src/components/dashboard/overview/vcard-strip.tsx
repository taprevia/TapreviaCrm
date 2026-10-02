'use client';

/**
 * "Your vCards" card — horizontally scrollable strip of mini card tiles.
 * Each whole tile links to its editor. Falls back to an empty state with a
 * create action when the user has no cards yet.
 */

import Link from 'next/link';
import { CreditCard, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { initialsOf } from './helpers';
import { SectionCard } from './section-card';
import type { VcardStats, VcardSummary } from './types';
import type { SectionState } from './use-overview-data';

interface VcardStripCardProps {
  section: SectionState<VcardSummary[]>;
  stats: VcardStats;
  onCreateClick: () => void;
  className?: string;
}

function VcardTile({ vcard, isNewest }: { vcard: VcardSummary; isNewest: boolean }) {
  return (
    <Link
      href={`/dashboard/vcards/${vcard._id}/edit`}
      aria-label={`Edit ${vcard.name}`}
      className="group min-w-[220px] shrink-0 snap-start overflow-hidden rounded-xl bg-field/50 ring-1 ring-line-subtle transition-all duration-200 hover:bg-surface-2 hover:shadow-e2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      {/* Header strip: profile image or initials fallback */}
      <div className="relative h-16 bg-field">
        {vcard.profileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vcard.profileImageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-600 text-xs font-semibold text-white">
              {initialsOf(vcard.name)}
            </span>
          </div>
        )}
        {isNewest && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-bg/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-400 ring-1 ring-line-subtle backdrop-blur-sm">
            Newest
          </span>
        )}
      </div>

      {/* Body */}
      <div className="space-y-1 p-3">
        <h3 className="truncate text-sm font-semibold text-ink">{vcard.name}</h3>
        <p className="truncate font-mono text-xs text-accent-400">/{vcard.urlAlias}</p>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="flex items-center gap-1 text-xs tabular-nums text-ink-mute">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            {(vcard.stats?.taps ?? 0).toLocaleString()}
          </span>
          <Badge variant="default" className="bg-field text-[10px] uppercase text-ink-faint ring-line-subtle">
            {vcard.templateKey}
          </Badge>
        </div>
      </div>
    </Link>
  );
}

export function VcardStripCard({ section, stats, onCreateClick, className }: VcardStripCardProps) {
  if (section.status === 'disabled') return null;
  const latestId = stats.latestVcard?._id ?? null;

  return (
    <SectionCard title="Your vCards" viewAllHref="/dashboard/vcards" className={className}>
      {section.status === 'error' && (
        <p className="rounded-lg bg-bad/10 p-3 text-sm text-bad">Could not load your vCards.</p>
      )}
      {section.status === 'loading' && (
        <div role="status" aria-label="Loading vCards" className="flex gap-3 overflow-hidden pb-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-[220px] animate-pulse rounded-xl ring-1 ring-line-subtle">
              <div className="h-16 bg-field" />
              <div className="space-y-2 p-3">
                <div className="h-4 w-28 rounded-md bg-field" />
                <div className="h-3 w-20 rounded bg-field" />
              </div>
            </div>
          ))}
        </div>
      )}
      {section.status === 'ready' &&
        (section.data.length === 0 ? (
          <div className="-my-6">
            <EmptyState
              icon={CreditCard}
              title="No vCards yet"
              description="Create your first digital business card."
              action={{ label: 'Create one', onClick: onCreateClick }}
            />
          </div>
        ) : (
          <ul
            role="list"
            className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1"
            aria-label="Your vCards"
          >
            {section.data.map((vcard) => (
              <li key={vcard._id} role="listitem" className="flex">
                <VcardTile vcard={vcard} isNewest={vcard._id === latestId} />
              </li>
            ))}
          </ul>
        ))}
    </SectionCard>
  );
}
