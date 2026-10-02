import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BadgeProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  variant?: 'light' | 'dark' | 'accent' | 'outline';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  icon,
  variant = 'light',
  className,
}) => {
  const baseStyles = 'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-colors';

  const variants = {
    light: 'bg-white border border-gray-100 text-brand-navy shadow-xs',
    dark: 'bg-brand-navy/90 text-white border border-white/10',
    accent: 'bg-blue-50 text-brand-accent border border-blue-100',
    outline: 'bg-transparent border border-gray-300 text-gray-700',
  };

  return (
    <span className={twMerge(clsx(baseStyles, variants[variant], className))}>
      {icon && <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>}
      {children}
    </span>
  );
};
