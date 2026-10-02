'use client';

/**
 * Card and standee performance over time.
 *
 * Pick a bound card or assigned standee + window (7/30/90d), then render
 * per-action StatCards and a composed-div daily trend. Data comes from
 * useAnalyticsData; actions are dynamic, so tiles derive from the totals keys
 * in canonical order. Standees report a single "Card taps"~equivalent action
 * (tap); cards can report many.
 */

import { useMemo } from 'react';
import { BarChart3, QrCode } from 'lucide-react';
import { Button, EmptyState, SegmentedControl, Select, StatCard } from '@/components/ui';
import { SectionCard } from '@/components/dashboard/overview/section-card';
import { metaForAction, orderedActions } from '@/components/dashboard/analytics/action-meta';
import { RANGE_OPTIONS, targetKey, useAnalyticsData } from '@/components/dashboard/analytics/use-analytics-data';

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

export default function AnalyticsPage() {
  const { targets, selectedKey, selectTarget, range, setRange, state, retry, retryTargets } =
    useAnalyticsData();

  const data = state.status === 'ready' ? state.data : null;

  const actions = useMemo(() => (data ? orderedActions(data.totals) : []), [data]);

  // Per-day sum across every action — the trend shows total activity.
  const dailyTotals = useMemo(
    () =>
      (data?.series ?? []).map((point) => ({
        date: point.date,
        total: Object.values(point.counts).reduce((sum, n) => sum + n, 0),
      })),
    [data]
  );

  const grandTotal = useMemo(
    () => dailyTotals.reduce((sum, day) => sum + day.total, 0),
    [dailyTotals]
  );
  const peak = dailyTotals.reduce((max, day) => Math.max(max, day.total), 0);
  const trendMax = Math.max(...dailyTotals.map((d) => d.total), 1);

  const isEmpty = Boolean(
    data &&
      (Object.keys(data.totals).length === 0 || Object.values(data.totals).every((n) => n === 0))
  );

  const noTargets = targets.status === 'ready' && targets.options.length === 0;
  const loading = targets.status === 'loading' || (!noTargets && state.status === 'loading');

  const selectOptions = useMemo(() => {
    if (targets.status === 'ready')
      return targets.options.map((t) => ({ value: targetKey(t), label: t.name }));
    if (targets.status === 'error') return [{ value: '', label: 'Could not load products' }];
    return [{ value: '', label: 'Loading…' }];
  }, [targets]);

  const firstDay = dailyTotals[0];
  const lastDay = dailyTotals[dailyTotals.length - 1];

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Analytics</h1>
        <p className="mt-0.5 text-sm text-ink-mute">Card and standee performance over time</p>
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl bg-surface p-3 ring-1 ring-line-subtle">
        <Select
          options={selectOptions}
          value={selectedKey}
          onChange={selectTarget}
          disabled={targets.status !== 'ready'}
          aria-label="Choose card or standee"
          className="w-full sm:w-56"
        />
        <SegmentedControl
          options={RANGE_OPTIONS}
          value={range}
          onChange={setRange}
          aria-label="Date range"
          className="sm:ml-auto"
        />
      </div>

      {/* Products fetch failure — picker is unusable without them */}
      {!loading && targets.status === 'error' && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3 ring-1 ring-bad/25">
          <p className="text-sm text-bad">{targets.message}</p>
          <Button variant="ghost" size="sm" onClick={retryTargets}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label="Loading analytics">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle" />
            ))}
          </div>
          <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle" />
        </>
      )}

      {/* Fetch error */}
      {!loading && state.status === 'error' && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3 ring-1 ring-bad/25">
          <p className="text-sm text-bad">{state.message}</p>
          <Button variant="ghost" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {/* No bound cards or assigned standees to analyze yet */}
      {!loading && noTargets && (
        <div className="mt-6">
          <EmptyState
            icon={QrCode}
            title="No analytics sources yet"
            description="Analytics appear here for your bound cards and standees once they are linked."
          />
        </div>
      )}

      {/* Empty period */}
      {!loading && !noTargets && isEmpty && (
        <div className="mt-6">
          <EmptyState
            icon={BarChart3}
            title="No activity in this period"
            description="Interactions appear here once your card or standee is tapped, opened or shared."
          />
        </div>
      )}

      {/* Ready with data */}
      {!loading && data && (
        <>
          {/* Per-action totals */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {actions.map((action) => {
              const meta = metaForAction(action);
              return (
                <StatCard
                  key={action}
                  icon={meta.icon}
                  iconClassName={meta.iconClassName}
                  label={meta.label}
                  value={(data.totals[action] ?? 0).toLocaleString()}
                />
              );
            })}
          </div>

          {/* Daily trend — composed divs; Sparkline's min/max normalization flattens zero-heavy days */}
          <SectionCard title="Daily activity" className="mt-6">
            <div className="mb-3 flex justify-end">
              <span className="text-xs text-ink-faint">
                Peak {peak.toLocaleString()} · total {grandTotal.toLocaleString()}
              </span>
            </div>
            <div className="flex h-32 items-end gap-[2px]">
              {dailyTotals.map((day) => {
                const label = `${formatDay(day.date)}: ${day.total}`;
                return (
                  <div
                    key={day.date}
                    role="img"
                    aria-label={label}
                    title={label}
                    className="min-w-[2px] flex-1 rounded-t-sm bg-accent-500/60 transition-colors hover:bg-accent-400"
                    style={{ height: `${Math.max((day.total / trendMax) * 100, day.total > 0 ? 6 : 2)}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-faint">
              <span>{firstDay ? formatDay(firstDay.date) : ''}</span>
              <span>{lastDay ? formatDay(lastDay.date) : ''}</span>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
