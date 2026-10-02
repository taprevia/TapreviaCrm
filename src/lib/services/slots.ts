/**
 * Pure appointment-slot computation.
 *
 * No DB / IO — everything derives from (businessHours, date, booked labels),
 * so it stays trivially testable and is shared by the public booking surface
 * and any future owner-side tooling.
 *
 * All day arithmetic is done in UTC: clients send calendar dates ('YYYY-MM-DD')
 * and appointments are stored at UTC midnight, so "the day" must never depend
 * on the server's local timezone.
 */

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export interface BusinessHourEntry {
  day: string;
  enabled: boolean;
  from: string;
  to: string;
}

/** Canonical slot label: trimmed, single-spaced, uppercase — e.g. '10:00 AM'. */
export function normalizeSlot(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Parse strict 'YYYY-MM-DD' into a Date at T00:00:00Z, else null. */
export function utcMidnight(dateStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'HH:mm' (24h) → minutes since midnight. NaN when malformed. */
function hhmmToMinutes(value: string): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → 'h:mm AM/PM' (540 → '9:00 AM', 870 → '2:30 PM'). */
function fmt(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

/**
 * Compute bookable slot labels for one calendar day (interpreted in UTC).
 *
 * - Resolves the weekday monday-first against the business-hours entries.
 * - Disabled days (or empty from/to, or malformed times) yield [].
 * - Steps `slotMinutes` from `from` up to but EXCLUDING `to`.
 * - Drops any label already present in `booked` (compared after normalization).
 */
export function computeSlots(
  businessHours: BusinessHourEntry[],
  dateIso: string,
  slotMinutes = 30,
  booked: string[] = []
): string[] {
  const d = utcMidnight(dateIso);
  if (!d) return [];

  // getUTCDay(): 0=Sunday … 6=Saturday → shift to monday-first index.
  const idx = (d.getUTCDay() + 6) % 7;
  const entry = businessHours.find((b) => b.day === DAY_KEYS[idx]);
  if (!entry || !entry.enabled || !entry.from || !entry.to) return [];

  const start = hhmmToMinutes(entry.from);
  const end = hhmmToMinutes(entry.to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const bookedSet = new Set(booked.map(normalizeSlot));
  const slots: string[] = [];
  for (let t = start; t < end; t += slotMinutes) {
    const label = fmt(t);
    if (!bookedSet.has(label)) slots.push(label);
  }
  return slots;
}
