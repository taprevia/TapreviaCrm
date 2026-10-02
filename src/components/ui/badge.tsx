import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide',
          {
            'bg-gray-100 text-gray-700 ring-1 ring-gray-200': variant === 'default',
            'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200': variant === 'success',
            'bg-amber-50 text-amber-700 ring-1 ring-amber-200': variant === 'warning',
            'bg-red-50 text-red-700 ring-1 ring-red-200': variant === 'danger',
            'bg-blue-50 text-blue-700 ring-1 ring-blue-200': variant === 'info',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { Badge };
