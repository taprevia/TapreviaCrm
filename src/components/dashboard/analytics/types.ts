/**
 * Client-side contracts for the analytics dashboard.
 * Mirrors the live API: GET /api/analytics?cardId=&from=&to= and
 * GET /api/analytics?standeeId=&from=&to=.
 */

export type RangeKey = '7d' | '30d' | '90d';

export interface AnalyticsSeriesPoint {
  date: string;
  counts: Record<string, number>;
}

export interface AnalyticsResponse {
  series: AnalyticsSeriesPoint[];
  totals: Record<string, number>;
}

/** A single analyzable owned product: a bound card or an assigned standee. */
export interface AnalyticsTarget {
  kind: 'card' | 'standee';
  id: string;
  name: string;
}

/** Uniform API error body from `fail()` in `@/lib/api`. */
export interface ApiErrorBody {
  error?: string;
}
