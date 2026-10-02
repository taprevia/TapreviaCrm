/**
 * Shared client-side contracts for the dashboard subscribers feature.
 * Mirrors the live API: GET /api/newsletter-subscribers, GET …/export.
 */

export interface SubscriberVcardRef {
  name: string;
  urlAlias: string;
}

export interface Subscriber {
  _id: string;
  email: string;
  createdAt: string;
  card: SubscriberVcardRef;
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SubscribersResponse {
  items?: Subscriber[];
  meta?: ListMeta;
}

/** Uniform API error body from `fail()` in `@/lib/api`. */
export interface ApiErrorBody {
  error?: string;
}
