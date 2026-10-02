'use client';

import { forwardRef, useState, ButtonHTMLAttributes, MouseEvent } from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'checked'> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  defaultChecked?: boolean;
  size?: 'sm' | 'md';
}

const trackSizes = {
  md: 'w-11 h-6 p-0.5',
  sm: 'w-9 h-5 p-0.5',
} as const;

const thumbSizes = {
  md: 'h-5 w-5',
  sm: 'h-4 w-4',
} as const;

const thumbTravel = {
  md: { on: 'translate-x-5', off: 'translate-x-0' },
  sm: { on: 'translate-x-4', off: 'translate-x-0' },
} as const;

const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    { className, checked, onChange, defaultChecked = false, size = 'md', disabled, onClick, ...props },
    ref
  ) => {
    const [internalChecked, setInternalChecked] = useState(defaultChecked);
    const isChecked = checked ?? internalChecked;

    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (checked === undefined) setInternalChecked((prev) => !prev);
      onChange?.(!isChecked);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={isChecked}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full ring-1 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          trackSizes[size],
          isChecked ? 'bg-accent-600 ring-accent-600' : 'bg-line ring-line-subtle',
          disabled && 'opacity-40 cursor-not-allowed',
          className
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none block rounded-full bg-white shadow-e1 transition-transform duration-[220ms] ease-[cubic-bezier(0.34,1.3,0.64,1)]',
            thumbSizes[size],
            thumbTravel[size][isChecked ? 'on' : 'off']
          )}
        />
      </button>
    );
  }
);

Switch.displayName = 'Switch';

export { Switch };
