import { NextResponse } from 'next/server';

/** Stable machine-readable error codes for API responses. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'QUOTA'
  | 'NOT_FOUND'
  | 'GONE'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'LIMIT_REACHED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: string;
  code?: ErrorCode;
  details?: unknown;
}

/**
 * Uniform error response. `code` lets clients branch programmatically,
 * `details` carries structured context (e.g. zod flatten output).
 */
export function fail(
  status: number,
  code: ErrorCode,
  error: string,
  details?: unknown
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody =
    details !== undefined ? { error, code, details } : { error, code };
  return NextResponse.json(body, { status });
}

/** Uniform success response. */
export function ok<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data as Record<string, unknown> & T, { status });
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationDefaults {
  page?: number;
  limit?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

const MAX_LIMIT = 100;

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/** Parse `?page=&limit=` from search params. limit is clamped to ≤100. */
export function parsePagination(
  sp: URLSearchParams,
  defaults: PaginationDefaults = {}
): Pagination {
  const page = parsePositiveInt(sp.get('page'), defaults.page ?? 1);
  const rawLimit = parsePositiveInt(sp.get('limit'), defaults.limit ?? 20);
  const limit = Math.min(rawLimit, MAX_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}
