import { z } from 'zod';

// ─── Primitives ──────────────────────────────────────────────────────────────

/** Mongo ObjectId: exactly 24 hex chars. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

export const RESERVED_ALIASES = [
  'api',
  'admin',
  'dashboard',
  'login',
  'register',
  'profile',
  't',
  'qr',
  'c',
  'media',
  'public',
] as const;

/** Public vcard alias: lowercase alnum/hyphen, 3–40 chars, no reserved words. */
export const aliasSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]{2,39}$/,
    'Alias must be 3-40 characters: lowercase letters, digits, hyphens (no leading/trailing hyphen)'
  )
  .refine((v) => !(RESERVED_ALIASES as readonly string[]).includes(v), {
    message: 'This alias is reserved',
  });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Shared field helpers ────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Required email; trims input; never returns undefined. */
export const emailField = z
  .string()
  .trim()
  .max(255)
  .refine((v) => EMAIL_RE.test(v), 'Enter a valid email address');

/** Email that may be empty string ('' stored) but not garbage when present. */
export const optionalEmailField = z
  .string()
  .trim()
  .max(255)
  .refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email address');

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Strict external URL — for social links etc. */
export const httpUrlSchema = z
  .string()
  .max(2048)
  .refine(isHttpUrl, 'Must be a valid http(s) URL');

/**
 * Absolute http(s) URL OR site-relative media path ("/uploads/...", "/api/media/...").
 * Used where MEDIA_DRIVER=local serves files from our own origin.
 */
export const urlOrMediaPathSchema = z
  .string()
  .max(2048)
  .refine((v) => v.startsWith('/') || isHttpUrl(v), 'Must be a valid URL or /path');

/**
 * Like urlOrMediaPathSchema but also accepts '' (empty string = "no media set").
 * Use on optional media fields; clients legitimately submit '' when no file
 * is attached. Without this, those creates fail with VALIDATION_ERROR.
 */
export const optionalUrlOrMediaPathSchema = z
  .string()
  .max(2048)
  .refine((v) => v === '' || v.startsWith('/') || isHttpUrl(v), 'Must be a valid URL or /path');

export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter uppercase currency code');

/** 24h "HH:mm" or empty string (disabled day). */
export const timeOrEmptySchema = z.union([
  z.literal(''),
  z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24h)'),
]);
