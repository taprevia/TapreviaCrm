'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { BuilderShell } from '@/components/builder';

export default function VcardEditPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/products"
        className="inline-flex text-sm text-ink-mute transition-colors hover:text-ink"
      >
        ← My Products
      </Link>
      <BuilderShell id={id} />
    </div>
  );
}
