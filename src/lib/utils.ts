import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Cryptographically secure random string over a fixed charset.
 *
 * Uses Web Crypto (`crypto.getRandomValues`) so it behaves identically in the
 * browser and on the Node/server runtime (Next 14 requires Node >= 18). Bytes
 * at or above the largest whole multiple of the charset size are rejected and
 * redrawn, which removes modulo bias. Output length and charset are identical
 * to the previous Math.random implementation, so generated IDs keep the same
 * shape and uniqueness guarantees.
 */
function secureRandomChars(length: number, chars: string): string {
  const out: string[] = [];
  const limit = 256 - (256 % chars.length);
  const buffer = new Uint8Array(length);
  while (out.length < length) {
    crypto.getRandomValues(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      out.push(chars.charAt(byte % chars.length));
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export function generateCardUid(): string {
  return secureRandomChars(8, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
}

/**
 * Canonicalize a physical NFC card UID before storing or comparing.
 *
 * The existing system stores UIDs as mixed-case alphanumeric strings and
 * resolves NFC taps with an uppercased cardUid (see /t/[uid] and /r/[slug]).
 * Trimming + uppercasing preserves the existing format while making uniqueness
 * and lookups case-insensitive — the SAME NFC UID can never be bound twice
 * under a different case.
 */
export function normalizeCardUid(uid: string): string {
  return uid.trim().toUpperCase();
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function generateQrId(length = 8): string {
  return secureRandomChars(length, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
