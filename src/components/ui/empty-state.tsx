'use client';

import { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  variant?: 'default' | 'danger';
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div
        className={cn(
          'grid h-16 w-16 place-items-center rounded-2xl bg-surface-2 ring-1 ring-line-subtle',
          variant === 'danger' && 'bg-bad/10 ring-bad/30'
        )}
      >
        <Icon className={cn('h-7 w-7 text-ink-faint', variant === 'danger' && 'text-red-400')} />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-mute">{description}</p>
      )}
      {action && (
        <Button size="sm" className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
