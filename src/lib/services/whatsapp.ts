export interface WhatsAppEnquiryOpts {
  productName: string;
  /** Integer minor units (paise) — rendered as major units with 2 decimals. */
  priceMinor?: number;
  currency?: string;
  /**
   * Public alias of the originating card. Reserved for the share-URL suffix;
   * the current message template intentionally ends after the price part.
   */
  alias: string;
  cardName?: string;
}

/**
 * Build a wa.me deep link carrying a pre-filled product enquiry message.
 *
 * - Phone is reduced to digits only; fewer than 8 digits (or no phone at all)
 *   yields null so callers can hide the WhatsApp affordance entirely.
 * - Price segment is omitted when priceMinor is absent or zero.
 *   Template: `Hi <name>: I'm interested in "<product>" (<CUR> <price>).`
 */
export function buildWhatsAppEnquiryUrl(
  phone: string | undefined,
  opts: WhatsAppEnquiryOpts
): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;

  let message = `Hi${opts.cardName ? ` ${opts.cardName}:` : ','} I'm interested in "${opts.productName}"`;
  if (opts.priceMinor && opts.priceMinor > 0) {
    const currency = opts.currency ?? 'INR';
    message += ` (${currency} ${(opts.priceMinor / 100).toFixed(2)})`;
  }
  message += '.';

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
