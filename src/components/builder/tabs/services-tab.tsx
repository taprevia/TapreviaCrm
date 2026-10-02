'use client';

/**
 * Services tab — repeatable service/offering rows (used by the "panthevent"
 * template). Rows are stored as IServiceItem[]; incomplete rows stay editable
 * in the draft and are dropped from PATCH payloads by the draft hook's
 * sanitizer, mirroring the socials tab behaviour.
 */

import { type ChangeEvent } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { IServiceItem } from '@/types';
import { Input } from '@/components/ui';
import { useBuilder } from '../context';

const SERVICES_MAX = 30;

const darkInput =
  'border-line bg-field text-ink placeholder:text-ink-faint focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong';

export function ServicesTab() {
  const { draft, setField } = useBuilder();
  const services = draft.services ?? [];

  const update = (next: IServiceItem[]) => setField('services', next);

  const updateRow = (index: number, patch: Partial<IServiceItem>) => {
    update(services.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const moveRow = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= services.length) return;
    const next = [...services];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    update(next);
  };

  const removeRow = (index: number) => {
    update(services.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (services.length >= SERVICES_MAX) return;
    update([...services, { title: '', description: '' }]);
  };

  return (
    <div className="space-y-3">
      {services.length === 0 && (
        <p className="rounded-lg bg-surface px-3 py-6 text-center text-sm text-ink-faint ring-1 ring-line-subtle">
          No services yet — add your first one below.
        </p>
      )}

      {services.map((item, index) => (
        <div
          key={index}
          className="space-y-2 rounded-lg bg-surface p-3 ring-1 ring-line-subtle"
        >
          <Input
            aria-label={`Service name for row ${index + 1}`}
            type="text"
            placeholder="Service name (e.g. Event Planning)"
            className={`min-w-0 ${darkInput}`}
            value={item.title ?? ''}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateRow(index, { title: event.target.value })
            }
          />
          <textarea
            aria-label={`Service description for row ${index + 1}`}
            placeholder="Short description (optional)"
            rows={2}
            maxLength={300}
            className={`min-w-0 w-full resize-none rounded-lg px-3 py-2.5 text-sm ${darkInput}`}
            value={item.description ?? ''}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              updateRow(index, { description: event.target.value })
            }
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              aria-label={`Move service ${index + 1} up`}
              title="Move up"
              disabled={index === 0}
              onClick={() => moveRow(index, -1)}
              className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Move service ${index + 1} down`}
              title="Move down"
              disabled={index === services.length - 1}
              onClick={() => moveRow(index, 1)}
              className="grid h-7 w-7 place-items-center rounded-md text-ink-mute transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Delete service ${index + 1}`}
              title="Delete"
              onClick={() => removeRow(index)}
              className="grid h-7 w-7 place-items-center rounded-md text-red-400/80 transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={services.length >= SERVICES_MAX}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong py-2.5 text-sm font-medium text-ink-mute transition-colors hover:border-accent-500 hover:text-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 disabled:pointer-events-none disabled:opacity-40 sm:w-auto sm:px-6"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add service
        </button>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {services.length}/{SERVICES_MAX}
        </span>
      </div>
    </div>
  );
}
