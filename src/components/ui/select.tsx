'use client';

import { forwardRef, SelectHTMLAttributes, ChangeEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, value, onChange, label, placeholder, id, ...props }, ref) => {
    const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
      onChange(e.target.value);
    };

    return (
      <div className={cn('w-full', className)}>
        {label && (
          <label htmlFor={id} className="dark-label">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={id}
            value={value}
            onChange={handleChange}
            className="h-11 w-full appearance-none rounded-lg border border-line bg-field px-3 pr-8 text-sm text-ink [color-scheme:dark] transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        </div>
      </div>
    );
  }
);

Select.displayName = 'Select';

export { Select };
