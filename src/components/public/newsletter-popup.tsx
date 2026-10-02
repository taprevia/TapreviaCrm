'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';

const SUPPRESS_KEY = 'taprevia:newsletter:suppressed-at';
const SESSION_KEY = 'taprevia:newsletter:shown-session';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function isSuppressed(): boolean {
  try {
    const raw = localStorage.getItem(SUPPRESS_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < THIRTY_DAYS_MS;
  } catch {
    return false;
  }
}

function markShownForSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* storage unavailable — popup may reappear; acceptable */
  }
}

function alreadyShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Delayed newsletter prompt: bottom sheet on mobile / slide-up card on desktop.
 * Shows once per session after `delaySeconds` (default 8); "No thanks"
 * suppresses for 30 days via a localStorage timestamp.
 *
 * The popup is opt-in per customer: when `enabled` is false the delay timer is
 * never started, so the popup stays hidden regardless of session/suppression
 * state. The customer preference (`User.isNewsletterEnabled`) defaults to OFF.
 */
export function NewsletterPopup({
  alias,
  enabled,
  delaySeconds = 8,
}: {
  alias: string;
  enabled?: boolean;
  delaySeconds?: number;
}) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'subscribed' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const newsletterEnabled = enabled !== false;

  useEffect(() => {
    // Master switch (owner's User.isNewsletterEnabled) — checked on mount:
    // never arm the delay timer when the customer opted out.
    if (!newsletterEnabled) return;
    if (alreadyShownThisSession() || isSuppressed()) return;
    const delayMs = Math.max(0, delaySeconds) * 1000;
    const timer = setTimeout(() => {
      if (isSuppressed()) return;
      markShownForSession();
      setVisible(true);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [newsletterEnabled, delaySeconds]);

  /* Esc closes while open */
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  function dismissFor30Days() {
    try {
      localStorage.setItem(SUPPRESS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setVisible(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    setStatus('submitting');
    setErrorMessage('');
    try {
      const res = await fetch(
        `/api/public/cards/${encodeURIComponent(alias)}/newsletter`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
      );
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      setStatus('subscribed');
      setTimeout(() => setVisible(false), 2200);
    } catch {
      setStatus('error');
      setErrorMessage('Could not subscribe right now. Please try again.');
    }
  }

  if (!visible) return null;

  return (
    <aside
      role="dialog"
      aria-label="Newsletter signup"
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white p-5 shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-[380px] sm:rounded-2xl sm:border sm:shadow-e3"
    >
      {/* drag-handle bar (mobile affordance) */}
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 sm:hidden" />

      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Close newsletter signup"
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
      >
        <X size={18} aria-hidden="true" />
      </button>

      {status === 'subscribed' ? (
        <div role="status" className="flex items-center gap-3 py-4">
          <CheckCircle2 size={28} className="shrink-0 text-[var(--v-accent)]" aria-hidden="true" />
          <p className="text-sm font-semibold text-gray-900">You&rsquo;re on the list!</p>
        </div>
      ) : (
        <>
          <h3 className="text-base font-bold text-gray-900">Stay updated</h3>
          <p className="mt-1 text-sm text-gray-500">
            Get occasional news and offers straight to your inbox.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2.5">
            <label htmlFor="nl-email" className="sr-only">
              Email address
            </label>
            <input
              id="nl-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[var(--v-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--v-accent)]/20"
            />
            {status === 'error' && errorMessage && (
              <p className="text-xs text-red-600" role="alert">
                {errorMessage}
              </p>
            )}
            <button
              type="submit"
              disabled={status === 'submitting'}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--v-accent)] text-sm font-semibold text-[var(--v-on-accent)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'submitting' ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  Subscribing…
                </>
              ) : (
                'Subscribe'
              )}
            </button>
            <button
              type="button"
              onClick={dismissFor30Days}
              className="h-9 w-full rounded-lg text-xs font-medium text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
            >
              No thanks
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
