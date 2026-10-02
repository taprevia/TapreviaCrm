'use client';

/**
 * Admin platform overview — single fetch to GET /api/admin/overview (new
 * contract: `totals` + `recent`). Response is typed locally against the
 * contract so this page never depends on API internals. Visual language
 * mirrors /dashboard (StatCard tiles, compact inquiry rows, UTC date blocks).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays,
  Download,
  HardDrive,
  Inbox,
  Nfc,
  Package,
  ShoppingBag,
  Users,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { cn } from '@/lib/utils';

// ─── Response contract (GET /api/admin/overview) ─────────────────────────────

interface OverviewTotals {
  users: number;
  admins: number;
  customers: number;
  cards: number;
  activeCards: number;
  cardsByStatus: { active: number; unassigned: number; suspended: number };
  inquiries: number;
  newInquiries: number;
  appointments: number;
  upcomingAppointments: number;
  products: number;
  activeProducts: number;
  productEnquiries: number;
  newProductEnquiries: number;
  newsletterSubscribers: number;
  mediaFiles: number;
  mediaBytes: number;
}

interface RecentInquiry {
  _id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  createdAt: string;
  card: { urlAlias: string; name: string };
}

interface RecentAppointment {
  _id: string;
  visitorName: string;
  date: string;
  slot: string;
  status: string;
  card: { urlAlias: string; name: string };
}

interface OverviewResponse {
  totals: OverviewTotals;
  recent: { inquiries: RecentInquiry[]; appointments: RecentAppointment[] };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Human bytes: <1MB → KB (0dp), <1GB → MB (1dp), else GB (2dp). */
function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${(kb / (1024 * 1024)).toFixed(2)} GB`;
}

/** Compact relative timestamp ('5m ago', '2h ago', …) — same cadence as the dashboard. */
function relativeTime(iso: string): string {
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
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Pill styles ─────────────────────────────────────────────────────────────

const INQUIRY_PILL_CLASS: Record<string, string> = {
  new: 'bg-accent-600/15 text-accent-400',
  contacted: 'bg-warn/15 text-warn',
  won: 'bg-ok/15 text-ok',
  lost: 'bg-bad/15 text-bad',
};

const APPOINTMENT_PILL_CLASS: Record<string, string> = {
  pending: 'bg-warn/15 text-warn',
  confirmed: 'bg-accent-600/15 text-accent-400',
  completed: 'bg-ok/15 text-ok',
  cancelled: 'bg-bad/15 text-bad',
};

// ─── Appointment date block (UTC slice — dates are stored at UTC midnight) ───

const MONTHS_SHORT_UTC = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcDateParts(isoDate: string): { day: string; month: string } | null {
  if (isoDate.length < 10) return null;
  const day = isoDate.slice(8, 10);
  const month = MONTHS_SHORT_UTC[Number.parseInt(isoDate.slice(5, 7), 10) - 1];
  if (!month || !day) return null;
  return { day: String(Number.parseInt(day, 10)), month: month.toUpperCase() };
}

export default function AdminOverviewPage() {
  /** Card is light by default in the ui kit — these overrides re-skin it for the dark admin shell. */
  const CARD_DARK = 'bg-surface border-transparent ring-1 ring-line-subtle';

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/overview');
      const body = (await res.json().catch(() => null)) as (OverviewResponse & { error?: string }) | null;
      if (!res.ok) throw new Error(body?.error || 'Failed to load overview');
      if (!body?.totals || !body?.recent) throw new Error('Unexpected overview response');
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview, reloadKey]);

  /** Trigger a CSV download from the admin export endpoint. */
  const handleExport = async (type: 'users' | 'inquiries') => {
    try {
      const res = await fetch(`/api/admin/export?type=${type}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}-export.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const totals = data?.totals;

  // Stat tile definitions — rendered only once data is available.
  const statTiles = totals
    ? [
        {
          icon: Users,
          label: 'Users',
          value: totals.users.toLocaleString(),
          hint: `${totals.admins.toLocaleString()} admin · ${totals.customers.toLocaleString()} customer`,
        },
        {
          icon: Nfc,
          label: 'Cards',
          value: totals.cards.toLocaleString(),
          hint: `${totals.activeCards.toLocaleString()} bound`,
        },
        {
          icon: Inbox,
          label: 'Inquiries',
          value: totals.inquiries.toLocaleString(),
          hint: `${totals.newInquiries.toLocaleString()} new`,
        },
        {
          icon: CalendarDays,
          label: 'Appointments',
          value: totals.appointments.toLocaleString(),
          hint: `${totals.upcomingAppointments.toLocaleString()} upcoming`,
        },
        {
          icon: Package,
          label: 'Products',
          value: totals.products.toLocaleString(),
          hint: `${totals.activeProducts.toLocaleString()} active`,
        },
        {
          icon: ShoppingBag,
          label: 'Product Enquiries',
          value: totals.productEnquiries.toLocaleString(),
          hint: `${totals.newProductEnquiries.toLocaleString()} new`,
        },
        {
          icon: HardDrive,
          label: 'Storage',
          value: fmtBytes(totals.mediaBytes),
          hint: `${totals.mediaFiles.toLocaleString()} files`,
        },
      ]
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Platform overview</h1>
          <p className="mt-0.5 text-sm text-ink-mute">Platform-wide statistics across all customers</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void handleExport('users')}
            className="border-line-strong bg-transparent text-ink-mute hover:bg-white/5 hover:text-ink hover:border-line-strong focus:ring-accent-500"
          >
            <Download className="mr-2 h-4 w-4" />
            Users CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleExport('inquiries')}
            className="border-line-strong bg-transparent text-ink-mute hover:bg-white/5 hover:text-ink hover:border-line-strong focus:ring-accent-500"
          >
            <Download className="mr-2 h-4 w-4" />
            Inquiries CSV
          </Button>
        </div>
      </div>

      {/* Fetch error + retry */}
      {!loading && error && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-3">
          <p className="text-sm text-bad">{error}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-ink-mute hover:bg-white/5 hover:text-ink focus:ring-accent-500"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" role="status" aria-label={loading ? 'Loading platform statistics' : undefined}>
        {loading &&
          Array.from({ length: 7 }).map((_, i) => (
            <Card key={i} className={cn('p-5', CARD_DARK)}>
              <div className="animate-pulse">
                <div className="h-10 w-10 rounded-lg bg-field" />
                <div className="mt-4 h-3 w-20 rounded bg-field" />
                <div className="mt-2 h-7 w-14 rounded bg-field" />
              </div>
            </Card>
          ))}
        {!loading && statTiles.map((tile) => (
          <StatCard key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} hint={tile.hint} />
        ))}
      </div>

      {/* Two-column sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent inquiries — admins have no inquiry page of their own, so no view-all */}
        <Card className={cn('p-6', CARD_DARK)}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Recent inquiries</h2>
          </div>

          {loading && (
            <div role="status" aria-label="Loading recent inquiries" className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse space-y-1.5 rounded-xl p-3 ring-1 ring-line-subtle">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-28 rounded-md bg-field" />
                    <div className="ml-auto h-3 w-12 rounded bg-field" />
                  </div>
                  <div className="h-3 w-44 rounded bg-field" />
                  <div className="h-3 w-full max-w-xs rounded bg-field" />
                </div>
              ))}
            </div>
          )}

          {!loading && !error && data && data.recent.inquiries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="rounded-full bg-field p-3">
                <Inbox className="h-6 w-6 text-ink-faint" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium text-ink">No inquiries yet</p>
              <p className="mt-0.5 text-xs text-ink-mute">Customer cards will capture inquiries here.</p>
            </div>
          )}

          {!loading && data && data.recent.inquiries.length > 0 && (
            <ul role="list" className="space-y-2">
              {data.recent.inquiries.map((inquiry) => {
                const pillClass = INQUIRY_PILL_CLASS[inquiry.status] ?? 'bg-field text-ink-faint';
                return (
                  <li
                    key={inquiry._id}
                    className="flex items-start justify-between gap-4 rounded-xl p-3 ring-1 ring-line-subtle transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{inquiry.name}</h3>
                        <span className="ml-auto shrink-0 pl-2 text-xs text-ink-faint">
                          {relativeTime(inquiry.createdAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-ink-mute">{inquiry.email || 'No email'}</p>
                      <p className="line-clamp-1 text-sm text-ink-mute">{inquiry.message}</p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', pillClass)}>
                          {inquiry.status}
                        </span>
                        {inquiry.card.urlAlias && (
                          <a
                            href={`/profile/${inquiry.card.urlAlias}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-fit truncate font-mono text-xs text-accent-400 hover:underline"
                          >
                            /profile/{inquiry.card.urlAlias}
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Upcoming appointments */}
        <Card className={cn('p-6', CARD_DARK)}>
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Upcoming appointments</h2>
          </div>

          {loading && (
            <div role="status" aria-label="Loading upcoming appointments" className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-3">
                  <div className="h-12 w-10 shrink-0 rounded-lg bg-field" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-4 w-28 rounded-md bg-field" />
                    <div className="h-4 w-16 rounded-full bg-field" />
                  </div>
                  <div className="h-5 w-20 shrink-0 rounded-full bg-field" />
                </div>
              ))}
            </div>
          )}

          {!loading && !error && data && data.recent.appointments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="rounded-full bg-field p-3">
                <CalendarDays className="h-6 w-6 text-ink-faint" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium text-ink">Nothing booked</p>
              <p className="mt-0.5 text-xs text-ink-mute">Upcoming bookings will appear here.</p>
            </div>
          )}

          {!loading && data && data.recent.appointments.length > 0 && (
            <ul role="list" className="space-y-3">
              {data.recent.appointments.map((appt) => {
                const parts = utcDateParts(appt.date);
                const pillClass = APPOINTMENT_PILL_CLASS[appt.status] ?? 'bg-field text-ink-faint';
                return (
                  <li key={appt._id} className="flex items-center gap-3">
                    {/* Date block — day + short month derived from the UTC slice only */}
                    <div className="w-10 shrink-0 rounded-lg bg-field px-1 py-1.5 text-center ring-1 ring-line-subtle" aria-hidden="true">
                      <span className="block text-lg font-semibold leading-none tabular-nums text-ink">
                        {parts?.day ?? '–'}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                        {parts?.month ?? ''}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <h3 className="truncate text-sm font-semibold text-ink">{appt.visitorName}</h3>
                      <span className="inline-flex items-center rounded-full bg-accent-600/15 px-2 py-0.5 text-[10px] font-medium tabular-nums text-accent-400">
                        {appt.slot}
                      </span>
                    </div>

                    <span
                      className={cn(
                        'shrink-0 self-start rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                        pillClass
                      )}
                    >
                      {appt.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
