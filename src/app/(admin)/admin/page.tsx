'use client';

/**
 * Admin platform overview — single fetch to GET /api/admin/overview (new
 * contract: `totals` + `recent`). Response is typed locally against the
 * contract so this page never depends on API internals. Visual language
 * mirrors /dashboard (StatCard tiles, compact inquiry rows, UTC date blocks).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
          href: '/admin/users',
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
          href: '/admin/products',
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
        {!loading && statTiles.map((tile) => {
          const card = (
            <StatCard icon={tile.icon} label={tile.label} value={tile.value} hint={tile.hint} />
          );
          return tile.href ? (
            <Link
              key={tile.label}
              href={tile.href}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            >
              {card}
            </Link>
          ) : (
            <div key={tile.label}>{card}</div>
          );
        })}
      </div>

    </div>
  );
}
