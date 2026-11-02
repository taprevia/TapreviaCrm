'use client';

/**
 * Review Assistant tab — retired customer-facing card-level AI editor.
 *
 * All AI Review settings now live in Central Review Management. This tab only
 * performs the existing product-aware entitlement check and directs the
 * customer to the central location. Legacy Card.reviewAssistant values remain
 * readable by the server and are never deleted or rewritten here.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';
import { useBuilder } from '../context';

export function ReviewAssistantTab() {
  const { draft } = useBuilder();
  const [reviewAllowed, setReviewAllowed] = useState<boolean | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/cards/${draft._id}/review-entitlement`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setReviewAllowed(data?.entitled === true);
          return;
        }
      } catch {
        if (!cancelled) setCheckFailed(true);
      }
      if (!cancelled) setReviewAllowed(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [draft._id]);

  if (reviewAllowed === null) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg bg-surface px-4 py-8 text-sm text-ink-mute ring-1 ring-line-subtle" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking Review Assistant access…
      </div>
    );
  }

  if (reviewAllowed === false) {
    return (
      <div className="rounded-lg bg-surface px-4 py-8 text-center ring-1 ring-line-subtle">
        <Lock className="mx-auto mb-3 h-6 w-6 text-ink-faint" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">
          {checkFailed ? 'Could not check Review Assistant access' : 'AI Review Assistant not included'}
        </p>
        <p className="mt-1 text-sm text-ink-faint">
          {checkFailed
            ? 'Retry the page. Your existing settings have not been changed.'
            : 'Your current products don’t include the AI Review Assistant. Contact Taprevia to upgrade.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-accent-600/10 px-4 py-4 ring-1 ring-accent-600/20">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">AI Review settings are now managed centrally</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-mute">
              Category, languages, tone, review length, business context, welcome message and
              review destinations are configured once in Review Management and shared by your
              eligible products. Existing product-specific values are preserved and are not
              changed automatically.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard/review-management">
          <Button type="button" size="sm">
            Open Review Management
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Link>
      </div>

      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-faint">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Disabling AI does not remove the Google Reviews page or the product’s existing public
        profile destination.
      </p>
    </div>
  );
}
