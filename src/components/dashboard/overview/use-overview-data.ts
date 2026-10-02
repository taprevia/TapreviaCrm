'use client';

/**
 * Data hook for the dashboard overview.
 *
 * Capabilities are resolved SERVER-SIDE and passed in by the page wrapper
 * (single source of truth — the client never asks for entitlements). Only the
 * endpoints the customer is entitled to are fired; every other section is
 * marked `disabled` and hidden by its card component. Each job owns its
 * errors, so one failing endpoint degrades only its own section.
 */

import { useCallback, useEffect, useState } from 'react';
import type { CapabilityId } from '@/config/capabilities';
import type {
  ApiErrorBody,
  VcardSummary,
  VcardsResponse,
} from './types';

/** Per-endpoint lifecycle: loading → ready | error | disabled (not entitled). */
export type SectionState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T }
  | { status: 'disabled' };

export interface OverviewData {
  vcards: SectionState<VcardSummary[]>;
}

const INITIAL: OverviewData = {
  vcards: { status: 'disabled' },
};

/** Capability required for each entitlement-relevant overview section. */
export const OVERVIEW_CAPABILITIES = {
  vcards: 'profile_edit',
} as const satisfies Record<keyof OverviewData, CapabilityId>;

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

/** GET JSON or throw the API's error message. */
async function getJson<T extends object>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const data = (await res.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data as T;
}

export function useOverviewData(capabilities: CapabilityId[]) {
  const capSet = new Set(capabilities);
  const canVcards = capSet.has(OVERVIEW_CAPABILITIES.vcards);

  const [data, setData] = useState<OverviewData>(INITIAL);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setData({
      vcards: canVcards ? { status: 'loading' } : { status: 'disabled' },
    });

    const jobs: Array<Promise<void>> = [];

    if (canVcards) {
      jobs.push(
        getJson<VcardsResponse>('/api/cards?page=1&limit=100', signal)
          .then((payload) =>
            setData((prev) => ({
              ...prev,
              vcards: { status: 'ready', data: payload.cards ?? payload.vcards ?? [] },
            }))
          )
          .catch((err: unknown) => {
            if (!signal.aborted && !isAbortError(err)) {
              setData((prev) => ({ ...prev, vcards: { status: 'error', message: errorMessage(err) } }));
            }
          })
      );
    }

    void Promise.all(jobs); // rejections already handled per-section

    return () => controller.abort();
  }, [reloadKey, canVcards]);

  /** Re-run all entitled fetches (global Retry button). */
  const retryAll = useCallback(() => setReloadKey((key) => key + 1), []);

  const loading = canVcards && data.vcards.status === 'loading';

  const allFailed = canVcards && data.vcards.status === 'error';

  const entitled = { vcards: canVcards };

  return { data, loading, allFailed, retryAll, entitled };
}
