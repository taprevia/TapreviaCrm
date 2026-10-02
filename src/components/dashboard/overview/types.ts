/**
 * Client-side contracts for the dashboard overview.
 * Mirrors the live APIs: /api/cards.
 * Kept local to the overview so it stays decoupled from other feature folders.
 */

// ─── Shared meta ──────────────────────────────────────────────────────────────

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Uniform API error body from `fail()` in `@/lib/api`. */
export interface ApiErrorBody {
  error?: string;
}

// ─── GET /api/cards ───────────────────────────────────────────────────────────

export interface VcardSummary {
  _id: string;
  name: string;
  urlAlias: string;
  templateKey: string;
  isActive?: boolean;
  profileImageUrl?: string | null;
  stats?: { taps?: number } | null;
  createdAt?: string;
}

export interface VcardsResponse {
  cards?: VcardSummary[];
  vcards?: VcardSummary[];
  meta?: ListMeta;
}

/** Aggregates derived from the vCard list. */
export interface VcardStats {
  /** Sum of every card's stats.taps. */
  totalTaps: number;
  /** Cards where isActive !== false. */
  activeCount: number;
  /** Newest card by createdAt (falls back to list order). */
  latestVcard: VcardSummary | null;
}
