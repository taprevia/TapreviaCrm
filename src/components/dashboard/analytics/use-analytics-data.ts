'use client';

/**
 * Data hook for the analytics page.
 *
 * Loads the analytics picker once on mount from GET /api/my/products — the
 * universal, capability-free list endpoint that already exposes the customer's
 * bound cards and assigned standees with their instance ids (no new API). The
 * first target is auto-selected, then daily aggregates are fetched from
 * GET /api/analytics keyed on [cardId | standeeId, range, reloadKey]. Stale
 * responses are aborted on target/range switches; parse failures surface the
 * API's error message.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsResponse, ApiErrorBody, RangeKey, AnalyticsTarget } from './types';

export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

const RANGE_DAYS: Record<RangeKey, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** A picker option key uniquely identifies a card vs a standee instance. */
export const targetKey = (target: { kind: AnalyticsTarget['kind']; id: string }): string =>
  `${target.kind}:${target.id}`;

export type TargetsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; options: AnalyticsTarget[] };

export type AnalyticsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AnalyticsResponse };

function isoDay(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

interface MyProductRow {
  instanceType?: 'card' | 'standee' | null;
  productTitle?: string;
  catalogProduct?: { name?: string } | null;
  instance?: { id?: string | null; name?: string | null } | null;
}

export function useAnalyticsData() {
  const [targets, setTargets] = useState<TargetsState>({ status: 'loading' });
  const [selectedKey, setSelectedKey] = useState('');
  const [range, setRange] = useState<RangeKey>('30d');
  const [state, setState] = useState<AnalyticsState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [targetsReloadKey, setTargetsReloadKey] = useState(0);

  // Picker options come from the universal /api/my/products list: each row with
  // an instantiated product (instance.id present) is an analyzable target.
  useEffect(() => {
    const controller = new AbortController();
    setTargets({ status: 'loading' });

    fetch('/api/my/products', { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | ({ products?: MyProductRow[] } & ApiErrorBody)
          | null;
        if (!res.ok) throw new Error(data?.error || 'Failed to load your products');
        const rows: MyProductRow[] = Array.isArray(data?.products) ? data.products : [];
        const options = rows.flatMap((row): AnalyticsTarget[] => {
          const kind = row.instanceType === 'card' || row.instanceType === 'standee' ? row.instanceType : null;
          const id = row.instance?.id;
          if (!kind || !id) return [];
          return [
            {
              kind,
              id,
              name:
                row.productTitle ||
                row.instance?.name ||
                row.catalogProduct?.name ||
                (kind === 'card' ? 'NFC Card' : 'Standee'),
            },
          ];
        });
        return options;
      })
      .then((options) => {
        if (controller.signal.aborted) return;
        setTargets({ status: 'ready', options });
        setSelectedKey((current) => current || (options[0] ? targetKey(options[0]) : ''));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setTargets({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load your products',
        });
      });

    return () => controller.abort();
  }, [targetsReloadKey]);

  useEffect(() => {
    if (!selectedKey) return;

    const separator = selectedKey.indexOf(':');
    const kind = selectedKey.slice(0, separator) as AnalyticsTarget['kind'];
    const id = selectedKey.slice(separator + 1);
    if (!id) return;

    const controller = new AbortController();
    setState({ status: 'loading' });

    const today = new Date();
    const days = RANGE_DAYS[range];
    const from = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1)));
    const params = new URLSearchParams({ from, to: isoDay(today) });
    if (kind === 'standee') params.set('standeeId', id);
    else params.set('cardId', id);

    fetch(`/api/analytics?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as (AnalyticsResponse & ApiErrorBody) | null;
        if (!res.ok) throw new Error(data?.error || 'Failed to load analytics');
        return data as AnalyticsResponse;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to load analytics',
        });
      });

    return () => controller.abort();
  }, [selectedKey, range, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);
  const retryTargets = useCallback(() => setTargetsReloadKey((key) => key + 1), []);

  return {
    targets,
    selectedKey,
    selectTarget: setSelectedKey,
    range,
    setRange,
    state,
    retry,
    retryTargets,
  };
}