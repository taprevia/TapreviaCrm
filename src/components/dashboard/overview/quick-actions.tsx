'use client';

/**
 * "Quick actions" card — product-driven shortcuts into each owned product
 * experience. Rendered as Links (not buttons) so they behave like native
 * navigations and stay valid, accessible markup.
 *
 * Only actions whose required capability is present render, so the list always
 * matches the customer's actual product set. The card action routes through the
 * SAME canonical resolver as the header CTA and My Products rows: when the
 * customer owns exactly one card product it lands on that card's specific
 * editor (bound) or its assignment config page (unbound); otherwise it falls
 * back to the vCards section list.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CreditCard, QrCode } from 'lucide-react';
import { SectionCard } from './section-card';
import { resolveProductManageHref } from '@/lib/product-route';
import type { CapabilityId } from '@/config/capabilities';

interface OverviewProduct {
  assignmentId: string;
  productTitle?: string;
  instanceType: 'card' | 'standee' | null;
  catalogProduct?: { name?: string } | null;
  instance?: { id?: string | null; name?: string | null } | null;
}

interface QuickActionsCardProps {
  capabilities: CapabilityId[];
  className?: string;
}

export function QuickActionsCard({ capabilities, className }: QuickActionsCardProps) {
  const capSet = new Set(capabilities);
  const [products, setProducts] = useState<OverviewProduct[] | null>(null);

  // Same universal endpoint the header CTA and My Products card read — the
  // resolver needs a real, single card product (never the "first card").
  useEffect(() => {
    let cancelled = false;
    fetch('/api/my/products')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('unavailable'))))
      .then((data) => {
        if (!cancelled) setProducts(data.products || []);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cardProducts = (products ?? []).filter(
    (p) => p.instanceType === 'card' && p.instance?.id
  );
  const singleCard = cardProducts.length === 1 ? cardProducts[0] : null;
  const cardManageHref = singleCard
    ? resolveProductManageHref({
        assignmentId: singleCard.assignmentId,
        instanceType: singleCard.instanceType,
        instance: singleCard.instance,
      })
    : '/dashboard/vcards';

  const actions: Array<{
    key: string;
    href: string;
    label: string;
    icon: typeof CreditCard;
  }> = [];
  if (capSet.has('profile_edit')) {
    actions.push({
      key: 'card',
      href: cardManageHref,
      label: singleCard ? `Manage ${singleCard.productTitle ?? singleCard.catalogProduct?.name ?? 'your card'}` : 'Manage your vCards',
      icon: CreditCard,
    });
  }
  if (capSet.has('standee')) {
    actions.push({
      key: 'standee',
      href: '/dashboard/standees',
      label: 'Configure standee slots',
      icon: QrCode,
    });
  }

  if (actions.length === 0) return null;

  return (
    <SectionCard title="Your products" className={className}>
      <ul role="list" className="space-y-2">
        {actions.map(({ key, href, label, icon: Icon }) => (
          <li key={key} role="listitem">
            <Link
              href={href}
              className="group inline-flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
            >
              <Icon className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-accent-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}