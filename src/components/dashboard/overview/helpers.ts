/**
 * Pure helpers for the dashboard overview. Kept free of React so they are
 * trivially testable and safe to call during render.
 */

import type { VcardStats, VcardSummary } from './types';

// ─── Greeting ─────────────────────────────────────────────────────────────────

/** 'Good morning' | 'Good afternoon' | 'Good evening' from the viewer's local clock. */
export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// ─── Text ─────────────────────────────────────────────────────────────────────

/** Up-to-two leading initials for avatar fallbacks ('Prince Sharma' → 'PS'). */
export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || '?'
  );
}

/**
 * Compact relative timestamp: 'just now', '5m ago', '2h ago', …
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── vCard aggregates ─────────────────────────────────────────────────────────

/** Sum taps, count active cards, and find the newest card in one pass-ish. */
export function deriveVcardStats(vcards: VcardSummary[]): VcardStats {
  let totalTaps = 0;
  let activeCount = 0;
  let latest: { createdAt: number; vcard: VcardSummary } | null = null;

  for (const vcard of vcards) {
    totalTaps += vcard.stats?.taps ?? 0;
    // Undefined/null isActive is treated as active — the API omits it on defaults.
    if (vcard.isActive !== false) activeCount += 1;

    const createdAtMs = vcard.createdAt ? new Date(vcard.createdAt).getTime() : NaN;
    if (!Number.isNaN(createdAtMs) && (latest === null || createdAtMs > latest.createdAt)) {
      latest = { createdAt: createdAtMs, vcard };
    }
  }

  return { totalTaps, activeCount, latestVcard: latest?.vcard ?? vcards[0] ?? null };
}
