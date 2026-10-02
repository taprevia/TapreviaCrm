'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Link2, Mail, MessageSquare, Phone, Share2, UserPlus } from 'lucide-react';
import { requestVcfDownload } from '@/lib/vcf-download';
import { BrandIcon } from './socials-row';
import type { IVcard } from './types';

function telHref(phone: string | undefined): string | null {
  const raw = phone?.trim();
  return raw ? `tel:${raw.replace(/[^\d+]/g, '')}` : null;
}

function waHref(phone: string | undefined): string | null {
  const digits = phone?.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

/**
 * Fixed bottom action dock: Call · WhatsApp · Share · Add to Contact.
 * Hidden entirely when config.hideStickyBar is true. Pair with
 * <StickyDockSpacer /> at the end of the page to reserve layout space.
 *
 * Share always fires a fire-and-forget 'share' track event first, then uses
 * navigator.share where available; otherwise opens the fallback sheet
 * (WhatsApp / SMS / Email / Copy link). The public tree has no ToastProvider,
 * so copy feedback is rendered inline.
 */
export function StickyDock({ vcard }: { vcard: IVcard }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstItemRef = useRef<HTMLAnchorElement | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  // Contact-details gate (endpoint answers 428). A direct navigation to the
  // .vcf URL used to fail silently here, so the dock collects name + email
  // and retries with them.
  const [gateOpen, setGateOpen] = useState(false);
  const [gateName, setGateName] = useState('');
  const [gateEmail, setGateEmail] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);
  const gateNameRef = useRef<HTMLInputElement | null>(null);
  const addToContactRef = useRef<HTMLButtonElement | null>(null);

  /* Sheet lifecycle: Esc to close, body scroll lock, focus in/out. */
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstItemRef.current?.focus();
    const shareButton = shareButtonRef.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      shareButton?.focus();
    };
  }, [sheetOpen]);

  /* Clear a pending "Link copied" timer on unmount. */
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  /* Gate sheet: Esc to close, scroll lock, focus the first field. */
  useEffect(() => {
    if (!gateOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGateOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => gateNameRef.current?.focus(), 40);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      window.clearTimeout(focusTimer);
      addToContactRef.current?.focus();
    };
  }, [gateOpen]);

  if (vcard.config?.hideStickyBar) return null;

  const name = vcard.name;
  const phone = vcard.basic?.phone;
  const call = telHref(phone);
  const chat = waHref(phone);

  async function handleAddToContact() {
    const result = await requestVcfDownload(vcard.urlAlias || '');
    if (result.status === 'gateRequired') {
      setGateError(null);
      setGateOpen(true);
      return;
    }
    if (result.status === 'error') {
      console.error('[vcf] download failed:', result.message);
      setGateError('Could not save the contact. Please try again.');
      setGateOpen(true);
    }
  }

  async function handleGateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gateBusy) return;
    const name = gateName.trim();
    const email = gateEmail.trim();
    if (name.length === 0) {
      setGateError('Please enter your name.');
      return;
    }
    // Deliberately loose: the endpoint stores the lead, and over-strict client
    // validation here would block legitimate addresses.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setGateError('Please enter a valid email address.');
      return;
    }
    setGateBusy(true);
    setGateError(null);
    const result = await requestVcfDownload(vcard.urlAlias || '', { name, email });
    setGateBusy(false);
    if (result.status === 'downloaded') {
      setGateOpen(false);
      return;
    }
    setGateError(
      result.status === 'gateRequired'
        ? 'Please enter your name and email address.'
        : 'Could not save the contact. Please try again.',
    );
  }

  function handleShareClick() {
    // Track FIRST, unconditionally — fire-and-forget, never blocks sharing.
    void fetch('/api/public/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ alias: vcard.urlAlias, action: 'share' }),
    }).catch(() => {});

    const url = `${window.location.origin}/profile/${vcard.urlAlias}`;
    if (typeof navigator.share === 'function') {
      navigator
        .share({
          title: name,
          text: `Check out ${name}'s digital card`,
          url,
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setSheetOpen(true);
        });
      return;
    }
    setSheetOpen(true);
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/profile/${vcard.urlAlias}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          setSheetOpen(false);
        }, 2000);
      })
      .catch(() => {});
  }

  const cellClass =
    'flex min-h-[64px] flex-col items-center justify-center gap-1 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--v-accent)]';
  const labelClass = 'text-[11px] font-medium leading-none text-gray-600';

  const shareText = `Check out ${name}'s digital card`;
  const enc = encodeURIComponent;
  /* Lazy: window exists only post-hydration — never during SSR render. */
  const shareHref = () => `${window.location.origin}/profile/${vcard.urlAlias}`;
  const rowClass =
    'flex h-12 w-full items-center gap-3 rounded-xl px-4 text-sm font-medium text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]';

  return (
    <>
      <nav
        aria-label="Quick actions"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto grid max-w-md grid-cols-4">
          {/* Call — ghost column */}
          {call ? (
            <a href={call} className={cellClass} aria-label={`Call ${name}`}>
              <Phone size={22} className="text-gray-900" aria-hidden="true" />
              <span className={labelClass}>Call</span>
            </a>
          ) : (
            <span className={`${cellClass} opacity-40`} aria-hidden="true">
              <Phone size={22} className="text-gray-900" />
              <span className={labelClass}>Call</span>
            </span>
          )}

          {/* WhatsApp — filled brand pill */}
          {chat ? (
            <a href={chat} target="_blank" rel="noopener noreferrer" className={cellClass} aria-label="Chat on WhatsApp">
              <span className="flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 text-[#0B0F19]">
                <BrandIcon platform="whatsapp" size={20} />
              </span>
              <span className={labelClass}>WhatsApp</span>
            </a>
          ) : (
            <span className={`${cellClass} opacity-40`} aria-hidden="true">
              <span className="flex h-11 items-center rounded-full bg-[#25D366] px-5 text-[#0B0F19]">
                <BrandIcon platform="whatsapp" size={20} />
              </span>
              <span className={labelClass}>WhatsApp</span>
            </span>
          )}

          {/* Share — ghost button mirroring Call */}
          <button type="button" ref={shareButtonRef} onClick={handleShareClick} className={cellClass} aria-label={`Share ${name}`}>
            <Share2 size={22} className="text-gray-900" aria-hidden="true" />
            <span className={labelClass}>Share</span>
          </button>

          {/* Add to Contact — ink pill */}
          <button
            type="button"
            ref={addToContactRef}
            onClick={handleAddToContact}
            className={cellClass}
            aria-label="Add to contacts (downloads vCard)"
          >
            <span className="flex h-11 max-w-full items-center rounded-full bg-[#111827] px-3.5 text-white">
              <UserPlus size={20} aria-hidden="true" />
            </span>
            <span className={`${labelClass} max-w-full truncate`}>Add to Contact</span>
          </button>
        </div>
      </nav>

      {/* Fallback share sheet */}
      {sheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Share ${name}'s card`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="mx-auto w-full max-w-md rounded-t-2xl bg-white p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-pop">
            {copied ? (
              <div role="status" className="flex h-12 items-center gap-3 rounded-xl px-4 text-sm font-medium text-gray-900">
                <Check size={18} className="text-green-600" aria-hidden="true" />
                Link copied
              </div>
            ) : (
              <>
                <a
                  ref={firstItemRef}
                  href={`https://wa.me/?text=${enc(`${shareText} ${shareHref()}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={rowClass}
                >
                  <BrandIcon platform="whatsapp" size={18} />
                  WhatsApp
                </a>
                <a href={`sms:?body=${enc(`${shareText} ${shareHref()}`)}`} className={rowClass}>
                  <MessageSquare size={18} aria-hidden="true" />
                  SMS
                </a>
                <a
                  href={`mailto:?subject=${enc(name)}&body=${enc(`${shareText} ${shareHref()}`)}`}
                  className={rowClass}
                >
                  <Mail size={18} aria-hidden="true" />
                  Email
                </a>
                <button type="button" onClick={handleCopyLink} className={rowClass}>
                  <Link2 size={18} aria-hidden="true" />
                  Copy link
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Contact-details gate — only shown when the endpoint answers 428 */}
      {gateOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Save ${name}'s contact`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGateOpen(false);
          }}
        >
          <form
            onSubmit={handleGateSubmit}
            noValidate
            className="mx-auto w-full max-w-md rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-pop"
          >
            <h2 className="text-base font-semibold text-gray-900">Save Contact</h2>
            <p className="mt-1 text-[13px] text-gray-600">
              Enter your details to save {name}&apos;s contact.
            </p>

            <label className="mt-3 block text-[11px] font-medium text-gray-600" htmlFor="dock-gate-name">
              Name
            </label>
            <input
              ref={gateNameRef}
              id="dock-gate-name"
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={gateName}
              onChange={(e) => {
                setGateName(e.target.value);
                setGateError(null);
              }}
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
            />

            <label className="mt-3 block text-[11px] font-medium text-gray-600" htmlFor="dock-gate-email">
              Email
            </label>
            <input
              id="dock-gate-email"
              type="email"
              autoComplete="email"
              placeholder="you@email.com"
              value={gateEmail}
              onChange={(e) => {
                setGateEmail(e.target.value);
                setGateError(null);
              }}
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
            />

            {gateError && (
              <p role="alert" className="mt-2 text-[13px] font-medium text-red-600">
                {gateError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setGateOpen(false)}
                className="h-11 flex-1 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={gateBusy}
                className="h-11 flex-1 rounded-lg bg-[#111827] text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v-accent)]"
              >
                {gateBusy ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** Reserves vertical space so fixed dock content is never overlapped. */
export function StickyDockSpacer() {
  return <div aria-hidden="true" className="block h-24" />;
}
