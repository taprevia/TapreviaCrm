'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastRecord extends Required<Pick<ToastOptions, 'title'>> {
  id: number;
  description?: string;
  variant: ToastVariant;
  expiresAt: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION = { base: 5000, error: 8000 };
const MAX_VISIBLE = 3;
const MAX_STORED = 8;
const TICK_MS = 250;

const variantStyles: Record<
  ToastVariant,
  { border: string; iconColor: string; Icon: typeof CheckCircle2 }
> = {
  success: { border: 'border-l-ok', iconColor: 'text-ok', Icon: CheckCircle2 },
  error: { border: 'border-l-bad', iconColor: 'text-bad', Icon: AlertTriangle },
  info: { border: 'border-l-accent-500', iconColor: 'text-accent-500', Icon: Info },
  warning: { border: 'border-l-warn', iconColor: 'text-warn', Icon: AlertTriangle },
};

function ToastItem({
  record,
  onDismiss,
  onPauseChange,
}: {
  record: ToastRecord;
  onDismiss: (id: number) => void;
  onPauseChange: (id: number, paused: boolean) => void;
}) {
  const { Icon, border, iconColor } = variantStyles[record.variant];

  return (
    <div
      role={record.variant === 'error' ? 'alert' : undefined}
      onMouseEnter={() => onPauseChange(record.id, true)}
      onMouseLeave={() => onPauseChange(record.id, false)}
      className={cn(
        'flex w-[360px] gap-3 rounded-lg border border-line-subtle border-l-4 bg-surface p-4 shadow-e3 animate-toast-in',
        border
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{record.title}</p>
        {record.description && (
          <p className="mt-0.5 text-xs text-ink-mute">{record.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(record.id)}
        aria-label="Dismiss notification"
        className="shrink-0 self-start rounded-md p-0.5 text-ink-faint transition-colors hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<ToastRecord[]>([]);
  const pausedRef = useRef<Set<number>>(new Set());
  const remainingRef = useRef<Map<number, number>>(new Map());
  const idRef = useRef(0);

  useEffect(() => {
    if (records.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setRecords((prev) => {
        const next = prev.filter(
          (r) => pausedRef.current.has(r.id) || r.expiresAt > now
        );
        return next.length === prev.length ? prev : next;
      });
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, [records.length]);

  const dismiss = useCallback((id: number) => {
    pausedRef.current.delete(id);
    remainingRef.current.delete(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handlePauseChange = useCallback((id: number, paused: boolean) => {
    if (paused) {
      pausedRef.current.add(id);
      setRecords((prev) => {
        const target = prev.find((r) => r.id === id);
        if (target) remainingRef.current.set(id, Math.max(0, target.expiresAt - Date.now()));
        return prev;
      });
    } else {
      pausedRef.current.delete(id);
      const remaining = remainingRef.current.get(id);
      remainingRef.current.delete(id);
      if (remaining !== undefined) {
        setRecords((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, expiresAt: Date.now() + remaining } : r
          )
        );
      }
    }
  }, []);

  const toast = useCallback(({ title, description, variant = 'info' }: ToastOptions) => {
    idRef.current += 1;
    const duration = variant === 'error' ? DURATION.error : DURATION.base;
    setRecords((prev) => [
      ...prev.slice(-(MAX_STORED - 1)),
      { id: idRef.current, title, description, variant, expiresAt: Date.now() + duration },
    ]);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  const visible = records.slice(-MAX_VISIBLE);
  const hiddenCount = records.length - visible.length;

  return (
    <ToastContext.Provider value={value}>
      {children}
      {records.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-6 right-6 z-[70] flex flex-col items-end gap-3"
        >
          {hiddenCount > 0 && (
            <div className="pointer-events-auto rounded-full border border-line-subtle bg-field px-3 py-1 text-xs font-medium text-ink-mute shadow-e1">
              +{hiddenCount} more
            </div>
          )}
          {visible.map((record) => (
            <div key={record.id} className="pointer-events-auto">
              <ToastItem record={record} onDismiss={dismiss} onPauseChange={handlePauseChange} />
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
