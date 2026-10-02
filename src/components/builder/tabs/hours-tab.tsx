'use client';

/**
 * Business Hours tab — one row per weekday, Monday-first.
 *
 * from/to are plain HH:mm strings exactly as timeOrEmptySchema expects.
 * The draft hook normalizes the array to all 7 days on hydration, and sends
 * it wholesale (the route replaces businessHours atomically, keeping order).
 */

import type { ChangeEvent } from 'react';
import { Copy } from 'lucide-react';
import type { DayOfWeek, IBusinessHour } from '@/types';
import { Button, Input, Switch } from '@/components/ui';
import { useBuilder } from '../context';

const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const darkTimeInput =
  'border-line bg-field text-ink focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong [color-scheme:dark]';

export function HoursTab() {
  const { draft, setField } = useBuilder();
  const hours = draft.businessHours ?? [];

  const updateRow = (index: number, patch: Partial<IBusinessHour>) => {
    setField(
      'businessHours',
      hours.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const copyMondayToAll = () => {
    const monday = hours.find((row) => row.day === 'monday');
    if (!monday) return;
    setField(
      'businessHours',
      hours.map((row) =>
        row.day === 'monday'
          ? row
          : { ...row, enabled: monday.enabled, from: monday.from, to: monday.to }
      )
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-faint">Shown in the Business hours section of your profile.</p>
        <Button variant="ghost" size="sm" onClick={copyMondayToAll} disabled={hours.length === 0}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy Monday to all
        </Button>
      </div>

      <ul className="divide-y divide-line-subtle overflow-hidden rounded-lg bg-surface ring-1 ring-line-subtle">
        {hours.map((row, index) => (
          <li
            key={row.day}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:flex-nowrap"
          >
            <span className="w-24 shrink-0 text-sm font-medium text-ink">
              {DAY_LABELS[row.day]}
            </span>
            <Switch
              size="sm"
              checked={row.enabled}
              onChange={(checked) => updateRow(index, { enabled: checked })}
              aria-label={`${DAY_LABELS[row.day]} open`}
            />
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Input
                aria-label={`${DAY_LABELS[row.day]} opens at`}
                type="time"
                className={`h-9 px-2 text-[13px] ${darkTimeInput}`}
                value={row.from}
                disabled={!row.enabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateRow(index, { from: event.target.value })
                }
              />
              <span aria-hidden="true" className="text-xs text-ink-faint">
                –
              </span>
              <Input
                aria-label={`${DAY_LABELS[row.day]} closes at`}
                type="time"
                className={`h-9 px-2 text-[13px] ${darkTimeInput}`}
                value={row.to}
                disabled={!row.enabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateRow(index, { to: event.target.value })
                }
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
