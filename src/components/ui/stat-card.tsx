import { forwardRef, HTMLAttributes } from 'react';
import { LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' };
  hint?: string;
  iconClassName?: string;
}

const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, icon: Icon, label, value, delta, hint, iconClassName, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl bg-surface p-5 shadow-e2 ring-1 ring-line-subtle',
          className
        )}
        {...props}
      >
        <div className="flex items-start justify-between">
          <div
            className={cn(
              'grid h-10 w-10 place-items-center rounded-lg bg-accent-600/10 text-accent-400',
              iconClassName
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          {delta && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                delta.direction === 'up'
                  ? 'bg-ok/10 text-ok'
                  : 'bg-bad/10 text-red-400'
              )}
            >
              {delta.direction === 'up' ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {delta.value}
            </span>
          )}
        </div>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-ink-mute">
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold leading-none tabular-nums text-white">{value}</p>
        {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
      </div>
    );
  }
);

StatCard.displayName = 'StatCard';

export { StatCard };
