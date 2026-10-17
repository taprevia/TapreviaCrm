/**
 * Presentation-only formatting helpers.
 *
 * These functions never touch business logic or persistence — they exist purely
 * so the admin UI can render prices defensively instead of emitting `₹NaN`
 * when a value is missing, null or malformed.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
};

const FALLBACK_CURRENCY_SYMBOL = '₹';
const DEFAULT_LOCALE = 'en-IN';

/**
 * Format a minor-unit amount (e.g. paise) as a display price.
 *
 * - Returns the em-dash placeholder when `priceMinor` is not a finite number,
 *   so callers never render `NaN`/`undefined`.
 * - Groups digits with the locale (default `en-IN`) and shows up to 2 fraction
 *   digits, trimming trailing zeros (`129900` → `₹1,299`, `129950` → `₹1,299.5`).
 * - Unknown currencies fall back to the rupee symbol.
 */
export function formatPriceMinor(
  priceMinor: unknown,
  currency?: string,
  locale?: string
): string {
  if (typeof priceMinor !== 'number' || !Number.isFinite(priceMinor)) {
    return '—';
  }

  const symbol =
    CURRENCY_SYMBOLS[(currency ?? 'INR').toUpperCase()] ?? FALLBACK_CURRENCY_SYMBOL;

  const amount = priceMinor / 100;
  const formatted = amount.toLocaleString(locale ?? DEFAULT_LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return `${symbol}${formatted}`;
}
