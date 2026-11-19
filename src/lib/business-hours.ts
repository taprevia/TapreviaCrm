/**
 * Shared, pure Business Hours helpers for public templates.
 *
 * The stored shape is `Card.businessHours: Array<{ day, enabled, from, to }>`,
 * already exposed through `toPublicRenderCardDto` as strings. This module
 * validates and orders the data for display; it never fetches private data,
 * never mutates stored records, and never invents hours for missing days.
 *
 * Times are 24-hour strings from the editor. Both canonical `HH:MM` and
 * server-validated legacy `H:MM` are accepted, normalized to `HH:MM` for
 * display only, and rendered as escaped React text by callers (never raw HTML).
 *
 * Legacy cards have no `businessHoursFormat`. They keep the historical 24h
 * display so existing profiles look exactly as before. Only an explicitly
 * stored `'12h'` / `'24h'` preference changes the presentation.
 */

export interface BusinessHourRow {
  day?: string;
  enabled?: boolean;
  from?: string;
  to?: string;
}

export interface OpenHours {
  day: string;
  label: string;
  from: string;
  to: string;
}

export type BusinessHoursFormat = '12h' | '24h';

export interface BusinessHourDisplayRow {
  day: string;
  label: string;
  /** True when the day has no valid opening hours (weekly off / missing / invalid). */
  closed: boolean;
  /** Already-formatted, escaped-by-React text: "09:00 – 17:00", "09:00 AM – 06:00 PM" or "Closed". */
  time: string;
}

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** Matches the server's accepted shape: `H:MM` or `HH:MM`, 00:00–23:59. */
const CLOCK_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** Display-only normalization: `9:00` → `09:00`. Invalid input returns null. */
function normalizeClock(value: string): string | null {
  const match = CLOCK_RE.exec(value.trim());
  if (!match) return null;
  const [hour, minute] = match[0].split(':') as [string, string];
  return `${String(Number(hour)).padStart(2, '0')}:${minute}`;
}

const DAY_LABELS: Record<(typeof DAY_ORDER)[number], string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Normalise a stored display preference. Anything unexpected (including the
 * legacy `undefined`) resolves to `24h`, preserving historical rendering.
 */
export function normalizeBusinessHoursFormat(value?: unknown): BusinessHoursFormat {
  return value === '12h' ? '12h' : '24h';
}

/** Convert one validated `HH:MM` string to 12h/24h display text. */
function formatClock(hhmm: string, format: BusinessHoursFormat): string {
  if (format === '24h') return hhmm;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/**
 * Return the open days (enabled with a valid `H:MM`/`HH:MM` from/to) in week
 * order. Values are normalized for display here; stored records are untouched.
 * Returns `[]` when there is no meaningful hours data, so templates hide the
 * section entirely. Invalid/partial/legacy entries are skipped safely.
 */
export function openBusinessHours(
  hours?: readonly BusinessHourRow[] | null
): OpenHours[] {
  if (!Array.isArray(hours) || hours.length === 0) return [];

  const byDay = new Map<string, BusinessHourRow>();
  for (const h of hours) {
    if (!h || typeof h !== 'object') continue;
    byDay.set(String(h.day ?? '').toLowerCase(), h);
  }

  const out: OpenHours[] = [];
  for (const day of DAY_ORDER) {
    const h = byDay.get(day);
    if (!h || h.enabled !== true) continue;
    const from = normalizeClock(String(h.from ?? ''));
    const to = normalizeClock(String(h.to ?? ''));
    if (!from || !to) continue;
    out.push({ day, label: DAY_LABELS[day], from, to });
  }
  return out;
}

/**
 * Public display rows for all seven weekdays, honouring weekly off (an
 * explicitly disabled day) and the optional 12h/24h display preference.
 *
 * - Returns `[]` when no day has valid opening hours → templates hide the
 *   whole section (empty / missing / legacy / all-closed profiles).
 * - Days without valid hours are rendered as "Closed"; no hours are invented.
 * - Stored `from`/`to` values are never modified; only display text is derived.
 */
export function publicBusinessHours(
  hours?: readonly BusinessHourRow[] | null,
  format?: unknown
): BusinessHourDisplayRow[] {
  const open = openBusinessHours(hours);
  if (open.length === 0) return [];

  const displayFormat = normalizeBusinessHoursFormat(format);
  const openByDay = new Map(open.map((row) => [row.day, row]));

  return DAY_ORDER.map((day) => {
    const row = openByDay.get(day);
    return row
      ? {
          day,
          label: DAY_LABELS[day],
          closed: false,
          time: `${formatClock(row.from, displayFormat)} – ${formatClock(row.to, displayFormat)}`,
        }
      : { day, label: DAY_LABELS[day], closed: true, time: 'Closed' };
  });
}
