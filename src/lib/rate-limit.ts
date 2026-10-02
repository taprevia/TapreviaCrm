/**
 * Fixed-window rate limiter backed by MongoDB counters.
 *
 * The old in-memory Map only worked inside a single process, which made it a
 * no-op across serverless instances. Windows are stored in the `ratecounters`
 * collection (one doc per key+window) with a TTL index for automatic purging.
 * The `check()` contract is unchanged so call sites only add an `await`.
 *
 * Failure mode: fail-open. If the store is unreachable the request is allowed
 * through — availability is preferred over blocking legit traffic.
 */

import { createHash } from 'crypto';
import RateCounter from '@/models/RateCounter';
import { connectDB } from '@/lib/db';

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  retryAfterSec: number;
}

function compactKey(key: string): string {
  // Keep index keys short — the raw key can carry emails/IPs of arbitrary
  // length.
  return createHash('sha256').update(key).digest('hex');
}

function deny(retryAfterMs: number): RateLimitResult {
  return {
    success: false,
    remaining: 0,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

/** Fixed-window check. Records a hit only when the request is allowed. */
export async function check(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const window = Math.floor(now / windowMs) * windowMs;
  const k = compactKey(key);

  try {
    await connectDB();
  } catch {
    return { success: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }

  try {
    const existing = (await RateCounter.findOne({ key: k, window })
      .select('hits')
      .lean()) as { hits: number } | null;
    if (existing && existing.hits >= limit) {
      return deny(window + windowMs - now);
    }

    // Atomic upsert-increment; concurrency slop (a few over limit under
    // heavy parallelism) is acceptable for a fixed window.
    const updated = (await RateCounter.findOneAndUpdate(
      { key: k, window },
      { $inc: { hits: 1 }, $setOnInsert: { expiresAt: new Date(now + windowMs) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean()) as { hits: number } | null;

    const hits = updated?.hits ?? 1;
    if (hits > limit) return deny(window + windowMs - now);

    return {
      success: true,
      remaining: Math.max(0, limit - hits),
      retryAfterSec: 0,
    };
  } catch (error) {
    console.error('rate-limit store failure (fail-open):', error);
    return { success: true, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }
}