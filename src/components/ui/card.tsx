import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('rounded-xl border border-gray-200/80 bg-white shadow-card transition-shadow duration-200 hover:shadow-card-hover', className)}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

export { Card };
