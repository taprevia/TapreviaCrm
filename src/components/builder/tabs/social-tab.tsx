'use client';

/**
 * Social Destination tab — configuration for "social card" experiences.
 *
 * A social card has no profile page: tapping or scanning it sends the visitor
 * to the redirect destination URL. The card's printed NFC/QR URL is stable —
 * changing the destination never changes what's printed on the card.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Badge, Input } from '@/components/ui';
import { generateQRDataURL } from '@/utils/qr';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

export function SocialDestinationTab() {
  const { draft, setField } = useBuilder();

  const kind = draft.kind ?? 'profile';
  const isActive = draft.isActive === true;
  const redirectUrl = draft.redirectUrl ?? '';

  const trimmed = redirectUrl.trim();
  const invalid = trimmed.length > 0 && !/^https?:\/\//i.test(trimmed);

  const publicSlug = (draft.publicSlug ?? '').trim();
  const alias = (draft.urlAlias ?? '').trim();
  const slug = (draft.slug ?? '').trim();
  // Human-friendly business public URL when allocated; legacy routes otherwise.
  const publicPath = publicSlug
    ? `/${publicSlug}`
    : alias
      ? `/profile/${alias}`
      : slug
        ? `/c/${slug}`
        : null;

  /* ── QR for the stable public URL ── */
  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    if (!publicPath) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    const url = `${window.location.origin}${publicPath}`;
    generateQRDataURL({ url, foreground: '#000000', background: '#FFFFFF', width: 512, margin: 2 })
      .then((generated) => {
        if (!cancelled) setQrDataUrl(generated);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [publicPath]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-subtle bg-bg p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Social card</p>
          <p className="text-xs text-ink-mute">
            No profile page — every tap sends the visitor to your destination.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={isActive ? 'success' : 'default'}>{isActive ? 'Active' : 'Suspended'}</Badge>
          <Badge variant="info">{kind}</Badge>
        </div>
      </div>

      <div className="min-w-0">
        <label htmlFor="social-redirect-url" className="mb-1.5 block text-sm font-medium text-ink-mute">
          Destination URL
        </label>
        <Input
          id="social-redirect-url"
          className={cn(darkInput, invalid && 'border-warn/70 focus:border-warn focus:ring-warn/25')}
          placeholder="https://linktr.ee/your-profile"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={redirectUrl}
          onChange={(event) => setField('redirectUrl', event.target.value)}
        />
        <p className={cn('mt-1.5 text-xs', invalid ? 'text-warn' : 'text-ink-faint')}>
          {invalid
            ? 'URL must start with http(s):// — fix it, then press Save to retry.'
            : 'Where this card sends visitors when it’s tapped or scanned.'}
        </p>
      </div>

      <div className="rounded-xl border border-line-subtle bg-bg p-4">
        <p className="mb-3 text-sm font-medium text-ink-mute">Dynamic card URL (printed on the card)</p>
        {publicPath ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg bg-white p-2">
              {qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- plain QR image
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${publicPath}`}
                  width={112}
                  height={112}
                  decoding="async"
                  className="h-28 w-28"
                />
              )}
            </div>
            <div className="min-w-0 space-y-2">
              <a
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600/10 px-3 py-1.5 text-xs font-semibold text-accent-400 ring-1 ring-accent-600/20 transition-colors hover:bg-accent-600/20"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Open card URL ({publicPath})
              </a>
              <p className="text-xs leading-relaxed text-ink-faint">
                This URL is stable and can be printed on the card. Changing the destination above
                never changes this URL — only where it takes the visitor.
              </p>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Set a profile URL to generate the card link and QR.
          </p>
        )}
      </div>
    </div>
  );
}