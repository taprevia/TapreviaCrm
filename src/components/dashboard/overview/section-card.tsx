'use client';

/**
 * Dark card shell shared by the overview sections: rounded surface with a
 * header row (title + optional "View all" link) and a padded body.
 * Built from raw dark tokens — the legacy `Card` component is light-themed.
 */

import { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function SectionCard({
  title,
  viewAllHref,
  viewAllLabel = 'View all',
  className,
  bodyClassName,
  children,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle',
        className
      )}
    >
      <header className="flex items-center justify-between gap-3 p-5 pb-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="inline-flex h-8 items-center gap-0.5 rounded-md px-2.5 text-xs font-medium text-accent-400 transition-colors hover:bg-white/5 hover:text-accent-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            {viewAllLabel}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </header>
      <div className={cn('min-h-0 flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}
