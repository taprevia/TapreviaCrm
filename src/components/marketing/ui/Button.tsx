import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'secondary' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  pill?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  pill = true,
  className,
  children,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

  const variants = {
    primary: 'bg-brand-navy hover:bg-brand-dark text-white shadow-sm focus:ring-brand-navy',
    secondary: 'bg-brand-accent hover:bg-brand-accentHover text-white focus:ring-brand-accent',
    outline: 'bg-white hover:bg-gray-50 text-brand-navy border border-gray-200 shadow-sm focus:ring-gray-300',
    dark: 'bg-gray-900 hover:bg-black text-white focus:ring-gray-900',
  };

  const sizes = {
    sm: 'px-4 py-2 text-xs font-semibold',
    md: 'px-6 py-3 text-sm font-semibold',
    lg: 'px-8 py-4 text-base font-bold',
  };

  const shape = pill ? 'rounded-full' : 'rounded-xl';

  return (
    <button
      className={twMerge(clsx(baseStyles, variants[variant], sizes[size], shape, className))}
      {...props}
    >
      {children}
    </button>
  );
};
