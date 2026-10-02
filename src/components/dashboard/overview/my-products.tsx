'use client';

/**
 * "My Products" overview card — read-only summary of the physical products the
 * admin has recorded for this customer (NFC cards, standees, other), showing
 * each product's status and setup state. Hidden entirely while the customer
 * owns no products; a failed fetch degrades to hidden rather than an error
 * state, matching the overview's graceful-degradation rule.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, Package, QrCode, Tag } from 'lucide-react';
import { SectionCard } from './section-card';
import { resolveProductManageHref } from '@/lib/product-route';
import {
  standeeConfigured,
  standeeNeedsSetup,
  unboundCardNeedsSetup,
} from '@/lib/product-status';
import type { ReactNode } from 'react';

interface CatalogProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  kind: string;
}

interface MyProductInstance {
  id: string;
  name: string;
  setupComplete?: boolean;
  isActive?: boolean;
  socialQrs?: Array<{ qrId: string; platform: string; label?: string; destinationUrl?: string }>;
}

interface MyProduct {
  assignmentId: string;
  productTitle?: string;
  catalogProduct: CatalogProduct | null;
  instanceType: 'card' | 'standee' | null;
  instance: MyProductInstance | null;
  quantity: number;
  material?: string;
}

const CATEGORY_ICON = {
  card: CreditCard,
  standee: QrCode,
  other: Tag,
  nfc_card: CreditCard,
  plate: Tag,
} as const;

const MATERIAL_LABEL: Record<string, string> = {
  pvc: 'PVC',
  metal: 'Metal',
  wooden: 'Wooden',
};

function categoryOf(p: MyProduct): keyof typeof CATEGORY_ICON {
  const c = p.catalogProduct?.category ?? '';
  return (
    c === 'card' || c === 'standee' || c === 'other' || c === 'nfc_card' || c === 'plate' ? c : 'other'
  ) as keyof typeof CATEGORY_ICON;
}

function badgeFor(p: MyProduct): ReactNode {
  const inst = p.instance;
  if (inst?.setupComplete === true) {
    return <span className="shrink-0 text-xs font-medium text-ok">Active</span>;
  }
  if (
    inst?.setupComplete === false ||
    unboundCardNeedsSetup(p) ||
    (p.instanceType === 'standee' && standeeNeedsSetup(inst))
  ) {
    return <span className="shrink-0 text-xs font-medium text-amber-400">Setup Required</span>;
  }
  if (p.instanceType === 'standee' && standeeConfigured(inst)) {
    return <span className="shrink-0 text-xs font-medium text-ok">Active</span>;
  }
  return null;
}

export function MyProductsCard({ className }: { className?: string }) {
  const [products, setProducts] = useState<MyProduct[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/my/products')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
      .then((data) => {
        if (!cancelled) setProducts(data.products || []);
      })
      .catch(() => {
        /* section stays hidden on failure */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || products.length === 0) return null;

  return (
    <SectionCard title="My Products" viewAllHref="/dashboard/products" viewAllLabel="View all" className={className}>
      <ul role="list" className="space-y-2">
        {products.slice(0, 6).map((product) => {
          const item = product.catalogProduct;
          const Icon = CATEGORY_ICON[categoryOf(product)];
          // Canonical manage target — same resolver as the My Products page and
          // the Phase 7 header CTA (instantiated card → specific editor,
          // standee → slot manager, otherwise → assignment config page).
          const href = resolveProductManageHref(product);
          const details =
            [product.quantity > 1 ? `${product.quantity}×` : null, MATERIAL_LABEL[product.material ?? ''] ?? null]
              .filter(Boolean)
              .join(' · ');

          const label = (
            <>
              <Icon className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-accent-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">
                {product.productTitle ?? item?.name ?? 'Product'}
                {details && <span className="ml-1.5 text-xs font-normal text-ink-faint">{details}</span>}
              </span>
              {badgeFor(product)}
            </>
          );
          const rowClass =
            'group inline-flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500';
          return (
            <li key={product.assignmentId} role="listitem">
              <Link href={href} className={rowClass}>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 border-t border-line-subtle pt-3 text-xs text-ink-faint">
        <Package className="h-3.5 w-3.5" aria-hidden="true" />
        Recorded by your Taprevia admin after purchase.
      </p>
    </SectionCard>
  );
}