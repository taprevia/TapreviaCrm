'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Copy,
  Eye,
  PenLine,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, EmptyState, SegmentedControl, Select, StatCard } from '@/components/ui';
import { SectionCard } from '@/components/dashboard/overview/section-card';
import type { ReviewApiError } from './types';

type RangeKey = '7d' | '30d' | '90d';

interface Counts {
  visits: number;
  totalCopies: number;
  aiCopies: number;
  manualCopies: number;
  unclassifiedCopies: number;
  rotationCopies: number;
  suggestionsShown: number;
  generated: number;
  googleClicks: number;
}

interface ProductRow extends Counts {
  hostKey: string;
  hostType: 'card' | 'standee';
  hostId: string;
  title: string;
  productName: string;
  active: boolean;
}

interface AnalyticsResponse {
  from: string;
  to: string;
  range: RangeKey;
  totals: Counts;
  series: Array<{
    date: string;
    visits: number;
    totalCopies: number;
    aiCopies: number;
    manualCopies: number;
  }>;
  products: ProductRow[];
}

const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
  });
}

function DailyBars({
  title,
  values,
  tone,
}: {
  title: string;
  values: Array<{ date: string; value: number }>;
  tone: string;
}) {
  const max = Math.max(...values.map((point) => point.value), 1);
  const first = values[0];
  const last = values[values.length - 1];

  return (
    <SectionCard title={title}>
      <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={`${title} by day`}>
        {values.map((point) => {
          const label = `${formatDay(point.date)}: ${point.value}`;
          return (
            <div
              key={point.date}
              title={label}
              aria-label={label}
              className={`min-w-[2px] flex-1 rounded-t-sm transition-colors ${tone}`}
              style={{
                height: `${Math.max((point.value / max) * 100, point.value > 0 ? 6 : 2)}%`,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-faint">
        <span>{first ? formatDay(first.date) : ''}</span>
        <span>{last ? formatDay(last.date) : ''}</span>
      </div>
    </SectionCard>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-2.5 py-2 ring-1 ring-line-subtle">
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

export function ReviewAnalyticsPanel() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [host, setHost] = useState('all');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(
      `/api/review-management/analytics?range=${encodeURIComponent(range)}&host=${encodeURIComponent(host)}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | AnalyticsResponse
          | ReviewApiError
          | null;
        if (!response.ok || !body || !('series' in body)) {
          throw new Error((body as ReviewApiError | null)?.error ?? 'Could not load review analytics.');
        }
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setData(body);
        if (host !== 'all' && !body.products.some((product) => product.hostKey === host)) {
          setHost('all');
        }
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          fetchError instanceof Error ? fetchError.message : 'Could not load review analytics.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [range, host, reloadKey]);

  const productOptions = useMemo(
    () => [
      { value: 'all', label: 'All review products' },
      ...(data?.products ?? []).map((product) => ({
        value: product.hostKey,
        label: `${product.title} · ${product.productName}`,
      })),
    ],
    [data]
  );

  const totals = data?.totals;
  const hasActivity = Boolean(
    totals &&
      (totals.visits ||
        totals.totalCopies ||
        totals.suggestionsShown ||
        totals.generated ||
        totals.googleClicks)
  );
  const firstDay = data?.series[0];
  const lastDay = data?.series[data.series.length - 1];

  return (
    <div
      id="review-panel-analytics"
      role="tabpanel"
      aria-labelledby="review-tab-analytics"
      className="space-y-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <BarChart3 className="h-4 w-4 text-accent-400" aria-hidden="true" />
            Review Analytics
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-mute">
            Visits and successfully copied reviews across your review products. A copied review is
            not a posted Google review.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Select
            id="review-analytics-product"
            aria-label="Filter review analytics by product"
            value={host}
            onChange={setHost}
            options={productOptions}
            className="w-full sm:w-64"
          />
          <SegmentedControl
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            aria-label="Review analytics date range"
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-4" role="status" aria-label="Loading review analytics">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-xl bg-surface ring-1 ring-line-subtle" />
            ))}
          </div>
          <div className="h-56 animate-pulse rounded-xl bg-surface ring-1 ring-line-subtle" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 rounded-xl bg-bad/10 px-3.5 py-3 text-sm text-red-300 ring-1 ring-bad/25" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="leading-relaxed">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Eye}
              label="Review Assistant visits"
              value={(totals?.visits ?? 0).toLocaleString()}
              hint="review_page_view events"
            />
            <StatCard
              icon={Sparkles}
              label="AI reviews copied"
              value={(totals?.aiCopies ?? 0).toLocaleString()}
              iconClassName="bg-violet-500/10 text-violet-400"
              hint="New events with source=ai"
            />
            <StatCard
              icon={PenLine}
              label="Manual reviews copied"
              value={(totals?.manualCopies ?? 0).toLocaleString()}
              iconClassName="bg-sky-500/10 text-sky-400"
              hint="New events with source=manual"
            />
            <StatCard
              icon={Copy}
              label="Total reviews copied"
              value={(totals?.totalCopies ?? 0).toLocaleString()}
              iconClassName="bg-emerald-500/10 text-emerald-400"
              hint="All successful copy events in this period"
            />
          </div>

          {!hasActivity && (
            <EmptyState
              icon={BarChart3}
              title="No review activity in this period"
              description="Review Assistant visits and copied reviews appear here once customers use your review pages."
            />
          )}

          {hasActivity && data.series.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              <DailyBars
                title="Daily Review Assistant visits"
                values={data.series.map((point) => ({ date: point.date, value: point.visits }))}
                tone="bg-sky-500/55 hover:bg-sky-400"
              />
              <DailyBars
                title="Daily reviews copied"
                values={data.series.map((point) => ({
                  date: point.date,
                  value: point.totalCopies,
                }))}
                tone="bg-accent-500/65 hover:bg-accent-400"
              />
            </div>
          )}

          <SectionCard title="Product activity">
            {data.products.length === 0 ? (
              <p className="text-sm leading-relaxed text-ink-mute">
                No review-capable products or historical review activity were found for this
                business.
              </p>
            ) : (
              <div className="space-y-2.5">
                {data.products.map((product) => (
                  <div
                    key={product.hostKey}
                    className="rounded-xl bg-field/40 p-3 ring-1 ring-line-subtle"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {product.title}
                      </p>
                      <Badge variant={product.active ? 'info' : 'default'}>
                        {product.active ? 'Active' : 'Historical'}
                      </Badge>
                      <Badge variant="default">{product.productName}</Badge>
                      <Badge variant="default">
                        {product.hostType === 'standee' ? 'Standee' : 'Card'}
                      </Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Metric label="Visits" value={product.visits} />
                      <Metric label="AI copied" value={product.aiCopies} />
                      <Metric label="Manual copied" value={product.manualCopies} />
                      <Metric label="Total copied" value={product.totalCopies} />
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <p className="text-[11px] leading-relaxed text-ink-faint">
            Total reviews copied counts every successful copy event in this period. AI and manual
            figures show the events whose source was recorded.
            {firstDay && lastDay
              ? ` Window: ${firstDay.date} to ${lastDay.date}.`
              : ''}
          </p>
        </>
      )}
    </div>
  );
}
