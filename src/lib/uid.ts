import { secureRandomChars } from '@/lib/utils';

/**
 * Timestamp-based unique identifiers for physical/digital product links.
 *
 * Format: base36(milliseconds) + N random base36 characters (default 2), e.g.
 * `m8k2p9a1x4`. The timestamp prefix is lexicographically sortable and makes
 * the creation time of an identifier human-eyeballable, while the entropy
 * suffix makes collisions within the same millisecond effectively impossible
 * (2 base36 chars = 1296 combos/ms; the `generateUnique…` allocator below adds
 * a DB-checked retry on top).
 *
 * These UIDs are used as the PRIMARY `routeSlug` (and mirrored to a dedicated
 * `uid` field) for NEW card/standee assignments only. Legacy identifiers
 * (`generateQrId`, admin-supplied `cardUid`, legacy `qrId`) remain untouched
 * and are still resolved by the dual-track resolvers.
 */

const UID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_ENTROPY_LENGTH = 2;

/**
 * Generate a short, collision-safe timestamp UID.
 *
 * @param entropyLength Number of random base36 characters appended to the
 *   base36 millisecond timestamp. Defaults to 2 (→ 10 chars total until 2059).
 */
export function generateTimestampUid(entropyLength: number = DEFAULT_ENTROPY_LENGTH): string {
  const timestamp = Date.now().toString(36);
  const entropy = secureRandomChars(entropyLength, UID_ALPHABET);
  return `${timestamp}${entropy}`;
}

/**
 * Allocate a timestamp UID that is not already taken according to `isTaken`.
 *
 * The unique sparse indexes on `routeSlug`/`uid` remain the ultimate guard, but
 * this pre-check keeps the common path collision-free (and lets callers retry
 * deterministically instead of surfacing a raw duplicate-key error).
 */
export async function generateUniqueTimestampUid(
  isTaken: (uid: string) => Promise<boolean>,
  maxAttempts = 6
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const uid = generateTimestampUid();
    // eslint-disable-next-line no-await-in-loop
    if (!(await isTaken(uid))) return uid;
  }
  throw new Error('Could not allocate a unique timestamp UID');
}
