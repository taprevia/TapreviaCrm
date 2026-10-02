'use client';

/**
 * Template tab — pick the card layout.
 *
 * Lists the templates granted to this customer by the admin
 * (GET /api/card-templates?cardId=) and writes `draft.templateKey`.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, LayoutTemplate, Loader2 } from 'lucide-react';
import { useBuilder } from '../context';
import { cn } from '@/lib/utils';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

interface TemplateMeta {
  key: string;
  name: string;
  description: string;
}

export function TemplateTab() {
  const { draft, setField, saveStatus } = useBuilder();
  const current = draft.templateKey ?? DEFAULT_TEMPLATE_KEY;
  const [templates, setTemplates] = useState<TemplateMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/card-templates?cardId=${encodeURIComponent(draft._id)}`);
        const data: { templates?: TemplateMeta[]; error?: string } = await res.json().catch(() => null);
        if (!res.ok || !data?.templates) {
          throw new Error(data?.error ?? 'Failed to load templates');
        }
        if (!cancelled) setTemplates(data.templates);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load templates');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft._id]);

  const selectedIsAvailable = (templates ?? []).some((t) => t.key === current);

  return (
    <div className="space-y-5">
      {error ? (
        <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-warn ring-1 ring-warn/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : !templates ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Selected template no longer granted — surface it, force a choice */}
          {templates.length > 0 && !selectedIsAvailable && (
            <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2.5 text-xs leading-relaxed text-warn ring-1 ring-warn/20">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Your current template is no longer available. Pick one from the list to keep the
              change (it will apply once saved).
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((tpl) => {
              const active = tpl.key === current;
              return (
                <button
                  key={tpl.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setField('templateKey', tpl.key)}
                  className={cn(
                    'group relative rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50',
                    active
                      ? 'border-accent-500 bg-accent-600/10 ring-1 ring-accent-600/20'
                      : 'border-line-subtle bg-field hover:border-accent-500/40'
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-600/15 text-accent-400">
                      <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{tpl.name}</span>
                      <span className="block truncate font-mono text-xs text-ink-faint">/{tpl.key}</span>
                    </span>
                    {active && (
                      <span className="ml-auto grid h-6 w-6 place-items-center rounded-full bg-accent-600 text-white">
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className="mt-2.5 block text-xs leading-relaxed text-ink-mute">
                    {tpl.description}
                  </span>
                </button>
              );
            })}
          </div>

          {templates.length === 0 && (
            <div className="rounded-xl border border-line-subtle bg-field p-8 text-center">
              <Loader2 className="mx-auto h-8 w-8 text-ink-faint" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-ink">No templates available</p>
              <p className="mt-1 text-xs text-ink-mute">
                The admin hasn&apos;t granted any templates — ask your business to enable at least
                one.
              </p>
            </div>
          )}

          <p className="text-xs text-ink-faint">
            {saveStatus === 'saving'
              ? 'Saving template choice…'
              : 'Your choice is saved automatically.'}
          </p>
        </>
      )}
    </div>
  );
}