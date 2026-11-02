'use client';

/**
 * Builder "Reviews" tab entry.
 *
 * This is intentionally not a settings form: review configuration has one
 * source of truth in Review Management. The tab gives review-only products a
 * valid, non-empty builder experience and a Card-scoped deep link.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, MessageSquareText } from 'lucide-react';
import { useBuilder } from '../context';

export function ReviewManagementLinkTab({
  cardId,
  showManagementAction = true,
}: {
  cardId: string;
  showManagementAction?: boolean;
}) {
  const { draft } = useBuilder();
  const alias = (draft.urlAlias ?? '').trim();
  const href = `/dashboard/review-management?cardId=${encodeURIComponent(cardId)}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line-subtle bg-field/40 p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-400 ring-1 ring-accent-600/20">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Review settings live in Review Management</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-mute">
              Configure the Google Review destination, welcome message, languages, style,
              topics and which settings this product inherits. Central settings are never
              overwritten by opening this page.
            </p>
            {showManagementAction && (
              <Link
                href={href}
                className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50"
              >
                Open Review Management
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {alias && (
        <div className="rounded-xl border border-line-subtle bg-field/40 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Public review path</p>
          <a
            href={`/review/${encodeURIComponent(alias)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm text-accent-400 hover:text-accent-300"
          >
            /review/{alias}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
            This URL only goes live once reviews are enabled in Review Management.
          </p>
        </div>
      )}
    </div>
  );
}

interface ReviewManagementStatusResponse {
  saved?: boolean;
  publicIntegrationEnabled?: boolean;
  settings?: {
    general?: {
      enabled?: boolean;
      googleReviewUrl?: string;
    };
  };
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-field/60 px-3 py-2 ring-1 ring-line-subtle">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Premium/profile entry: the profile experience keeps its full tab rail and
 * gains review status plus links. The complete Central settings interface is
 * intentionally not duplicated here.
 */
export function PremiumReviewManagementTab({ cardId }: { cardId: string }) {
  const { draft } = useBuilder();
  const alias = (draft.urlAlias ?? '').trim();
  const [status, setStatus] = useState<ReviewManagementStatusResponse | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/review-management');
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as ReviewManagementStatusResponse | null;
        if (!cancelled && data) setStatus(data);
      } catch {
        // Status is informational; the Review Management link remains usable.
      } finally {
        if (!cancelled) setStatusLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const statusUnavailable = statusLoaded && !status;
  const centralActive = status?.publicIntegrationEnabled === true;
  const centralSaved = status?.saved === true;
  const centralUrl = (status?.settings?.general?.googleReviewUrl ?? '').trim();
  const legacyUrl = (draft.reviewAssistant?.googleReviewUrl ?? '').trim();
  // A hybrid product can store its own destination while the central general
  // URL is empty. Treat either as configured without exposing the URL here.
  const destinationConfigured = Boolean(
    statusUnavailable
      ? legacyUrl
      : centralActive && centralSaved
        ? centralUrl || legacyUrl
        : legacyUrl
  );
  const managementHref = `/dashboard/review-management?cardId=${encodeURIComponent(cardId)}`;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line-subtle bg-field/40 p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-400 ring-1 ring-accent-600/20">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">Google Reviews</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-mute">
              Review Management is included for this Premium NFC Card. Effective settings and
              product overrides are managed centrally.
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <StatusRow label="Review Management" value="Included" />
          <StatusRow
            label="Central integration"
            value={
              statusUnavailable
                ? 'Open Review Management for current status'
                : !statusLoaded
                  ? 'Checking…'
                  : centralActive
                    ? 'Active'
                    : 'Off — product-specific settings apply'
            }
          />
          <StatusRow
            label="Central review availability"
            value={
              statusUnavailable
                ? 'See Review Management'
                : !statusLoaded
                  ? 'Checking…'
                  : !centralActive
                    ? 'Not active — product-specific settings apply'
                    : !centralSaved
                      ? 'Not configured centrally'
                      : status?.settings?.general?.enabled === true
                        ? 'Enabled'
                        : 'Disabled'
            }
          />
          <StatusRow
            label="Google Review destination"
            value={destinationConfigured ? 'Configured' : 'Not configured'}
          />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {alias && (
            <a
              href={`/review/${encodeURIComponent(alias)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50"
            >
              Open review page
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <Link
            href={managementHref}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50"
          >
            Open Review Management
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <ReviewManagementLinkTab cardId={cardId} showManagementAction={false} />
    </div>
  );
}
