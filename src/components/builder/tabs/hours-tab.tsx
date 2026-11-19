'use client';

/**
 * Business Hours tab — one row per weekday, Monday-first.
 *
 * from/to are plain HH:mm strings exactly as timeOrEmptySchema expects.
 * The draft hook normalizes the array to all 7 days on hydration, and sends
 * it wholesale (the route replaces businessHours atomically, keeping order).
 *
 * "Weekly Off" is a second view over the SAME `enabled` flags — never a
 * separate list. Marking a day off only flips `enabled` to false; the saved
 * `from`/`to` values stay untouched so un-marking restores them immediately.
 *
 * "Time Display Format" is a display-only preference stored on the card as
 * `businessHoursFormat`. Stored times stay canonical HH:mm; only the public
 * renderer converts them. Legacy cards (no preference) keep 24h display.
 */

import type { ChangeEvent } from 'react';
import { Copy } from 'lucide-react';
import type { DayOfWeek, IBusinessHour } from '@/types';
import type { BusinessHoursFormat } from '@/lib/business-hours';
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

const DAY_SHORT: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

const DAY_ORDER: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const darkTimeInput =
  'border-line bg-field text-ink focus:border-accent-500 focus:ring-accent-500/25 hover:border-line-strong [color-scheme:dark]';

export function HoursTab() {
  const { draft, setField } = useBuilder();
  const hours = draft.businessHours ?? [];

  // Legacy cards with saved times keep their historical 24-hour display until
  // the customer explicitly picks a format. Cards with no times yet are newly
  // configured profiles and start with the 12-hour default.
  const hasSavedTimes = hours.some((row) => Boolean(row.from || row.to));
  const selectedFormat: BusinessHoursFormat =
    draft.businessHoursFormat ?? (hasSavedTimes ? '24h' : '12h');

  /** Persist the chosen default once, the first time hours are edited. */
  const persistDefaultFormat = () => {
    if (draft.businessHoursFormat == null) {
      setField('businessHoursFormat', selectedFormat);
    }
  };

  const updateRow = (index: number, patch: Partial<IBusinessHour>) => {
    persistDefaultFormat();
    setField(
      'businessHours',
      hours.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const copyMondayToAll = () => {
    const monday = hours.find((row) => row.day === 'monday');
    if (!monday) return;
    persistDefaultFormat();
    setField(
      'businessHours',
      hours.map((row) =>
        row.day === 'monday'
          ? row
          : { ...row, enabled: monday.enabled, from: monday.from, to: monday.to }
      )
    );
  };

  /** Weekly Off toggles the same `enabled` flag — from/to are never touched. */
  const toggleWeeklyOff = (day: DayOfWeek) => {
    const index = hours.findIndex((row) => row.day === day);
    if (index < 0) return;
    const row = hours[index];
    updateRow(index, { enabled: row.enabled !== true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-faint">Shown in the Business hours section of your profile.</p>
        <Button variant="ghost" size="sm" onClick={copyMondayToAll} disabled={hours.length === 0}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copy Monday to all
        </Button>
      </div>

      {/* Set Time — one switch + two time inputs per weekday */}
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

      {/* Weekly Off — multiple days; displays as "Closed" on the profile */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink">Weekly Off</legend>
        <p className="text-xs text-ink-faint">
          Selected days show as Closed. Your saved times are kept and restored when you unselect a day.
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Weekly off days">
          {DAY_ORDER.map((day) => {
            const row = hours.find((h) => h.day === day);
            const isOff = row ? row.enabled !== true : true;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={isOff}
                onClick={() => toggleWeeklyOff(day)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                  isOff
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface text-ink-mute ring-1 ring-line-subtle hover:bg-surface-2'
                }`}
              >
                {DAY_SHORT[day]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Time Display Format — display-only, stored as businessHoursFormat */}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-ink">Time Display Format</legend>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Time display format">
          {(
            [
              { value: '12h', label: '12 Hours (AM/PM)' },
              { value: '24h', label: '24 Hours' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={selectedFormat === option.value}
              onClick={() => setField('businessHoursFormat', option.value)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${
                selectedFormat === option.value
                  ? 'bg-accent-500 text-white'
                  : 'bg-surface text-ink-mute ring-1 ring-line-subtle hover:bg-surface-2'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
