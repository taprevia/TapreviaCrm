import Counter from '@/models/Counter';

/**
 * Reserve the next number in a monotonic sequence. The counter is only ever
 * incremented — never decremented and never reset — so previously issued
 * numbers are never re-used (permanent identity semantics).
 *
 * The unique `_id` makes only the first-ever insert for a key race-able; on
 * that upsert race the loser retries the `findOneAndUpdate` so it simply
 * increments the winner's document instead of failing.
 */
export async function nextPermUniqueNumber(key: string): Promise<number> {
  const increment = async () => {
    const counter = await Counter.findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return counter?.seq ?? 1;
  };

  try {
    return await increment();
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) {
      return increment();
    }
    throw error;
  }
}

/**
 * Human-readable, permanent customer identifier: "CUST-" + zero-padded 6-digit
 * sequence (grows naturally past 6 digits). It is an identity label, not a
 * routing key — it is never used in URLs and never replaces the `_id`.
 */
export function formatCustomerId(seq: number): string {
  return `CUST-${String(seq).padStart(6, '0')}`;
}

/** Idempotent: returns the user's existing customer id, else allocates one. */
export async function assignCustomerId(user: {
  customerId?: string | null;
}): Promise<string> {
  if (user.customerId) return user.customerId;
  return formatCustomerId(await nextPermUniqueNumber('customerId'));
}