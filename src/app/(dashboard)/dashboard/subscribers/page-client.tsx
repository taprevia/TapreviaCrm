'use client';

/**
 * Newsletter subscribers.
 *
 * Paginated list scoped to the caller's vCards with debounced email search and
 * a vCard filter. Unsubscribed rows are excluded server-side. Export CSV
 * downloads everything matching the CURRENT filters (no pagination).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search, Users } from 'lucide-react';
import { Button, EmptyState, Input, Select } from '@/components/ui';
import { relativeTime } from '@/lib/relative-time';
import type {
  ApiErrorBody,
  ListMeta,
  Subscriber,
  SubscribersResponse,
} from '@/components/dashboard/subscribers/types';

const PAGE_SIZE = 20;

export default function SubscribersPage() {
  // List state
  const [items, setItems] = useState<Subscriber[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Filters (debounced search drives the actual query)
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cardId, setCardId] = useState('');

  // vCard filter options — fetched once
  const [vcardOptions, setVcardOptions] = useState<Array<{ _id: string; name: string }>>([]);

  const exportAnchorRef = useRef<HTMLAnchorElement | null>(null);

  // Debounce the search box (400ms) and reset pagination.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Current-filter querystring (shared shape with the CSV export).
  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (search) sp.set('search', search);
    if (cardId) sp.set('cardId', cardId);
    sp.set('page', String(page));
    sp.set('limit', String(PAGE_SIZE));
    return sp.toString();
  }, [search, cardId, page]);

  // Fetch the paginated list; stale responses are aborted on re-run.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/newsletter-subscribers?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as (SubscribersResponse & ApiErrorBody) | null;
        if (!res.ok) throw new Error(data?.error || 'Failed to load subscribers');
        return data as SubscribersResponse;
      })
      .then((data) => {
        setItems(data.items ?? []);
        setMeta(data.meta ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load subscribers');
        setLoading(false);
      });

    return () => controller.abort();
  }, [query, reloadKey]);

  // Populate the card filter once. Live API returns `{cards}`, fall back to `items`.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cards?limit=100')
      .then((res) => res.json().catch(() => null))
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== 'object') return;
        const payload = data as { cards?: unknown; vcards?: unknown; items?: unknown };
        const rows = (payload.cards ?? payload.vcards ?? payload.items ?? []) as Array<{ _id?: unknown; name?: unknown }>;
        setVcardOptions(
          rows.filter(
            (row): row is { _id: string; name: string } =>
              typeof row?._id === 'string' && typeof row?.name === 'string'
          )
        );
      })
      .catch(() => {
        /* filter population is best-effort; the list itself still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A deleted card or narrowed filter can strand an out-of-range page.
  useEffect(() => {
    if (!loading && !error && items.length === 0 && page > 1) setPage(1);
  }, [loading, error, items.length, page]);

  const vcardSelectOptions = useMemo(
    () => [
      { value: '', label: 'All vCards' },
      ...vcardOptions.map((v) => ({ value: v._id, label: v.name })),
    ],
    [vcardOptions]
  );

  /** Download a CSV of everything matching the CURRENT filters (no pagination). */
  function handleExport() {
    const anchor = exportAnchorRef.current;
    if (!anchor) return;
    const sp = new URLSearchParams();
    if (search) sp.set('search', search);
    if (cardId) sp.set('cardId', cardId);
    const qs = sp.toString();
    anchor.href = qs
      ? `/api/newsletter-subscribers/export?${qs}`
      : '/api/newsletter-subscribers/export';
    anchor.click();
  }

  const hasFilters = search !== '' || cardId !== '';
  const currentPage = meta?.page ?? page;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Subscribers</h1>
          {meta && <span className="text-sm tabular-nums text-ink-faint">{meta.total}</span>}
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Hidden download trigger */}
      <a
        ref={exportAnchorRef}
        href="/api/newsletter-subscribers/export"
        download
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      >
        Export CSV
      </a>

      {/* Filter bar */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 ring-1 ring-line-subtle">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search email…"
            aria-label="Search subscribers by email"
            className="h-11 border-line bg-field pl-9 text-ink placeholder-ink-faint hover:border-line-strong focus:border-accent-500 focus:ring-accent-500/25"
          />
        </div>
        <Select
          options={vcardSelectOptions}
          value={cardId}
          onChange={(value) => {
            setCardId(value);
            setPage(1);
          }}
          aria-label="Filter by vCard"
          className="w-full sm:w-48"
        />
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading subscribers">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex justify-between rounded-xl bg-surface p-4 ring-1 ring-line-subtle">
              <div className="min-w-0 flex-1 animate-pulse space-y-2">
                <div className="h-4 w-48 rounded bg-field" />
                <div className="h-3 w-64 rounded bg-field" />
              </div>
              <div className="ml-auto h-3 w-16 shrink-0 animate-pulse self-start rounded bg-field" />
            </div>
          ))}
        </div>
      )}

      {/* Fetch error */}
      {!loading && error && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3 ring-1 ring-bad/25">
          <p className="text-sm text-bad">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <EmptyState
          icon={Users}
          title={hasFilters ? 'No subscribers match' : 'No subscribers yet'}
          description={
            hasFilters ? 'Try clearing filters.' : 'Newsletter signups will appear here.'
          }
        />
      )}

      {/* Table */}
      {!loading && !error && items.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl bg-surface ring-1 ring-line-subtle">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line-subtle px-4 py-3 text-[11px] uppercase tracking-wider text-ink-mute">
                    Email
                  </th>
                  <th className="border-b border-line-subtle px-4 py-3 text-[11px] uppercase tracking-wider text-ink-mute">
                    Card
                  </th>
                  <th className="border-b border-line-subtle px-4 py-3 text-[11px] uppercase tracking-wider text-ink-mute">
                    Subscribed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {items.map((subscriber) => (
                  <tr key={subscriber._id}>
                    <td className="max-w-[280px] px-4 py-3.5">
                      <a
                        href={`mailto:${subscriber.email}`}
                        className="block truncate font-medium text-ink transition-colors hover:text-accent-400"
                      >
                        {subscriber.email}
                      </a>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="block truncate text-ink-mute">{subscriber.card.name}</span>
                      {subscriber.card.urlAlias && (
                        <a
                          href={`/profile/${subscriber.card.urlAlias}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-fit truncate font-mono text-xs text-accent-400 hover:underline"
                        >
                          /{subscriber.card.urlAlias}
                        </a>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs text-ink-faint">
                      {relativeTime(subscriber.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-6 flex items-center justify-end gap-3" aria-label="Pagination">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
              >
                <ChevronLeft className="mr-0.5 h-3.5 w-3.5" aria-hidden="true" />
                Prev
              </Button>
              <span className="text-xs tabular-nums text-ink-mute">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
                <ChevronRight className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
