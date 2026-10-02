'use client';

import { useEffect, useId, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
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

    if (isOpen) {
      openerRef.current = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        if (!panelRef.current) return;
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const preferred = panelRef.current.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select:not([disabled]), textarea:not([disabled])'
        );
        (preferred ?? focusables[0] ?? panelRef.current).focus();
      });
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
      const opener = openerRef.current;
      if (opener && opener.isConnected) opener.focus();
      openerRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white shadow-elevated animate-scale-in focus:outline-none',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
          {title && <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-auto"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
