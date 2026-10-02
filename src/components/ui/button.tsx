'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
          {
            'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm hover:shadow-md': variant === 'primary',
            'bg-gray-100 text-gray-900 hover:bg-gray-200/80 focus:ring-gray-400': variant === 'secondary',
            'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400 focus:ring-blue-500 shadow-sm': variant === 'outline',
            'text-gray-700 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-400': variant === 'ghost',
            'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm hover:shadow-md': variant === 'danger',
          },
          {
            'h-8 px-3 text-xs gap-1.5 rounded-md': size === 'sm',
            'h-10 px-4 text-sm': size === 'md',
            'h-12 px-6 text-sm': size === 'lg',
          },
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button };
