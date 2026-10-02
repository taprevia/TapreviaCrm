'use client';

/**
 * Customer dashboard overview — client page.
 *
 * Receives the SERVER-resolved capability list from the page wrapper and
 * renders only the sections those capabilities allow. Disallowed sections
 * short-circuit to `disabled` in the hook, so their endpoints are never even
 * called (no flashes, no useless 403s).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, Eye, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import {
  deriveVcardStats,
  greetingForHour,
} from '@/components/dashboard/overview/helpers';
import { useOverviewData } from '@/components/dashboard/overview/use-overview-data';
import { VcardStripCard } from '@/components/dashboard/overview/vcard-strip';
import { QuickActionsCard } from '@/components/dashboard/overview/quick-actions';
import { MyProductsCard } from '@/components/dashboard/overview/my-products';
import { resolveProductManageHref } from '@/lib/product-route';
import type { CapabilityId } from '@/config/capabilities';

interface DashboardOverviewProps {
  capabilities: CapabilityId[];
}

/** Minimal slice of GET /api/my/products used for header product awareness. */
interface OverviewProduct {
  assignmentId: string;
  productTitle?: string;
  catalogProduct: { name?: string; category?: string; kind?: string } | null;
  instanceType: 'card' | 'standee' | null;
  instance?: {
    id?: string | null;
    socialQrs?: readonly unknown[] | null;
  } | null;
}

export default function DashboardOverview({ capabilities }: DashboardOverviewProps) {
  const router = useRouter();
  const { data, loading, allFailed, retryAll, entitled } = useOverviewData(capabilities);

  // Hydration-safe greeting — the server's clock/zone differs from the viewer's.
  const [greeting, setGreeting] = useState('Welcome');
  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  // Product awareness for the header — the same endpoint the My Products card
  // uses (no new API). Only a customer with EXACTLY ONE card assignment gets a
  // precise Configure target; never the "first card".
  const [overviewProducts, setOverviewProducts] = useState<OverviewProduct[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/my/products')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
      .then((data) => {
        if (!cancelled) setOverviewProducts(data.products || []);
      })
      .catch(() => {
        /* keep null — the header falls back to neutral wording */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isCardProduct = (p: OverviewProduct): boolean =>
    p.instanceType === 'card' || p.catalogProduct?.category === 'card';

  const cardProducts = overviewProducts?.filter(isCardProduct) ?? null;
  const primaryProduct =
    cardProducts && cardProducts.length === 1 ? cardProducts[0] : null;
  const primaryName = primaryProduct?.productTitle ?? primaryProduct?.catalogProduct?.name ?? 'product';
  // Canonical manage target: exactly one card assignment → its specific editor;
  // otherwise the neutral My Products list. Never the "first card".
  const productsHref = primaryProduct
    ? resolveProductManageHref({
        assignmentId: primaryProduct.assignmentId,
        instanceType: primaryProduct.instanceType,
        instance: primaryProduct.instance,
      })
    : '/dashboard/products';

  // Aggregates derived once per vCards payload; empty while loading/erroring.
  const vcardStats = useMemo(
    () => deriveVcardStats(data.vcards.status === 'ready' ? data.vcards.data : []),
    [data.vcards]
  );

  return (
    <div className="animate-fade-in space-y-6">
      {/* Greeting row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{greeting}</h1>
          <p className="mt-1 text-sm text-ink-mute">
            {overviewProducts === null
              ? 'Loading your dashboard…'
              : primaryProduct
                ? `Manage and configure your ${primaryName}.`
                : 'Your products and dashboard tools, at a glance.'}
          </p>
        </div>
        <Link href={productsHref} className="shrink-0 self-start sm:self-auto">
          <Button size="sm">
            <Package className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {primaryProduct ? `Manage ${primaryName}` : 'My Products'}
          </Button>
        </Link>
      </div>

      {/* Global failure banner — every entitled endpoint failed */}
      {!loading && allFailed && (
        <div className="flex items-center justify-between gap-4 rounded-lg bg-bad/10 p-4 ring-1 ring-bad/25">
          <p className="text-sm text-bad">Could not load dashboard.</p>
          <Button variant="ghost" size="sm" onClick={retryAll}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <>
          <div
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            role="status"
            aria-label="Loading dashboard"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
            <div className="h-64 animate-pulse rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle lg:col-span-2" />
            <div className="h-64 animate-pulse rounded-xl bg-surface shadow-e2 ring-1 ring-line-subtle" />
          </div>
        </>
      )}

      {/* Content */}
      {!loading && !allFailed && (
        <>
          {/* Stats row — only entitled stats render */}
          {entitled.vcards && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {entitled.vcards && (
                <>
                  <StatCard
                    icon={Eye}
                    label="Total taps"
                    value={vcardStats.totalTaps.toLocaleString()}
                    hint={data.vcards.status === 'error' ? 'Unavailable' : undefined}
                  />
                  <StatCard
                    icon={CreditCard}
                    label="Active vCards"
                    value={`${vcardStats.activeCount}/${data.vcards.status === 'ready' ? data.vcards.data.length : 0}`}
                    hint={data.vcards.status === 'error' ? 'Unavailable' : undefined}
                  />
                </>
              )}
            </div>
          )}

          {/* Bottom row */}
          {entitled.vcards ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <VcardStripCard
                section={data.vcards}
                stats={vcardStats}
                onCreateClick={() => router.push('/dashboard/vcards')}
                className="lg:col-span-2"
              />
              <QuickActionsCard capabilities={capabilities} />
            </div>
          ) : (
            <QuickActionsCard capabilities={capabilities} />
          )}

          {/* Owned physical products — renders nothing until the customer owns some */}
          <MyProductsCard />
        </>
      )}
    </div>
  );
}