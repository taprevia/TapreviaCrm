/**
 * Public VCF-gate contact validation.
 *
 * The gate accepts a name, email and optional international phone number from
 * anonymous visitors. Values are normalized and bounded before they can reach
 * the Inquiry collection. Unicode names and international phone punctuation
 * are preserved.
 */

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-.\s]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface NormalizedVcfContact {
  name: string;
  email: string;
  phone: string;
}

export type VcfContactResult =
  | { ok: true; contact: NormalizedVcfContact }
  | { ok: false; field: 'name' | 'email' | 'phone'; message: string };

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeVcfContact(input: {
  name: string;
  email: string;
  phone?: string;
}): VcfContactResult {
  const name = normalizeName(input.name ?? '');
  if (!name || name.length > MAX_NAME || CONTROL_RE.test(name)) {
    return { ok: false, field: 'name', message: 'Enter a valid name (up to 100 characters).' };
  }

  const email = (input.email ?? '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL || CONTROL_RE.test(email) || !EMAIL_RE.test(email)) {
    return { ok: false, field: 'email', message: 'Enter a valid email address.' };
  }

  const phone = (input.phone ?? '').trim();
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    if (
      phone.length > MAX_PHONE ||
      CONTROL_RE.test(phone) ||
      !PHONE_RE.test(phone) ||
      digits.length < 3 ||
      digits.length > 15
    ) {
      return {
        ok: false,
        field: 'phone',
        message: 'Enter a valid phone number (3–15 digits; +, spaces, dashes and parentheses allowed).',
      };
    }
  }

  return { ok: true, contact: { name, email, phone } };
}
