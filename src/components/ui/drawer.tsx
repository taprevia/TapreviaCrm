'use client';

import { useEffect, useId, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({ open, onClose, title, children, footer, width = 480 }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    const raf = requestAnimationFrame(() => {
      if (!panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusables[0] ?? panelRef.current).focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(raf);
      document.body.style.overflow = '';
      const opener = openerRef.current;
      if (opener && opener.isConnected) opener.focus();
      openerRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ width }}
        className="fixed bottom-0 right-0 top-0 flex max-w-[92vw] flex-col border-l border-line-subtle bg-surface shadow-rail animate-slide-in-right focus:outline-none"
      >
        {title && (
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-line-subtle px-6">
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
        )}
        {!title && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-lg p-2 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <div className="flex-1 space-y-6 overflow-y-auto p-6">{children}</div>
        {footer && (
          <footer className="shrink-0 border-t border-line-subtle p-4">{footer}</footer>
        )}
      </div>
    </div>
  );
}
