'use client';

import { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value)
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    e.preventDefault();
    const next = (activeIndex + dir + options.length) % options.length;
    onChange(options[next].value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn('inline-flex items-center gap-1 rounded-lg bg-field p-1 ring-1 ring-line-subtle', className)}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 rounded-md px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
              isActive ? 'bg-line text-ink shadow-e1' : 'text-ink-mute hover:text-ink'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
