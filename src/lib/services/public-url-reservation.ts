import Card from '@/models/Card';
import Counter from '@/models/Counter';
import PublicUrlReservation from '@/models/PublicUrlReservation';
import Standee from '@/models/Standee';
import { nextPermUniqueNumber } from '@/lib/services/customer-identity';

/**
 * Permanent Standee public-URL reservation.
 *
 * Invariant: once a canonical public path has been issued to a product identity
 * it must never be issued to a different identity — even after the original
 * Standee, assignment, or account is deleted.
 *
 * The reservation collection is the permanent authority. The Counter supplies
 * monotonically increasing candidates; the unique path index arbitrates races.
 */

export const STANDEES_PUBLIC_SEGMENT = 'standee';
export const PUBLIC_URL_RESERVATION_READY_KEY = 'public-url-reservation:ready';

const PUBLIC_URL_MAX_LENGTH = 100;
const MAX_ALLOCATION_ATTEMPTS = 50;
const BIZ_SLUG_PATTERN = /^[a-z0-9-]{1,50}$/;
const STANDEE_PUBLIC_PATH_PATTERN = /^([a-z0-9-]{1,50})\/standee(?:-([1-9][0-9]*))?$/;

export class PublicUrlReservationNotReadyError extends Error {
  readonly code = 'PUBLIC_URL_RESERVATION_NOT_READY';

  constructor() {
    super('Permanent public URL reservations are not ready for allocation');
    this.name = 'PublicUrlReservationNotReadyError';
  }
}

export class PublicUrlReservationConflictError extends Error {
  readonly code = 'PUBLIC_URL_RESERVATION_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'PublicUrlReservationConflictError';
  }
}

export interface ParsedStandeePublicSlug {
  path: string;
  bizSlug: string;
  suffix: number;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** Canonical publicSlug normalization used only for comparison/validation. */
export function normalizePublicSlug(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^\/+/, '')
    .toLowerCase();
}

/**
 * Parse a canonical Standee public path. Uppercase/leading-slash/extra-segment
 * values are rejected; stored identifiers are expected to already be canonical.
 */
export function parseStandeePublicSlug(
  value: string | null | undefined
): ParsedStandeePublicSlug | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > PUBLIC_URL_MAX_LENGTH) return null;
  if (raw.startsWith('/')) return null;
  if (raw !== raw.toLowerCase()) return null;
  const match = STANDEE_PUBLIC_PATH_PATTERN.exec(raw);
  if (!match) return null;
  const suffix = match[2] ? Number(match[2]) : 1;
  if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
  return { path: raw, bizSlug: match[1], suffix };
}

export function isCanonicalStandeePublicSlug(value: string | null | undefined): boolean {
  return parseStandeePublicSlug(value) !== null;
}

export function standeeSuffixFromPublicSlug(
  value: string | null | undefined
): number | null {
  return parseStandeePublicSlug(value)?.suffix ?? null;
}

/** Sequence 1 -> "{biz}/standee"; 2 -> "{biz}/standee-2"; ... */
export function standeePathForSequence(
  bizSlug: string | null | undefined,
  sequence: number
): string | null {
  const biz = String(bizSlug ?? '').trim().toLowerCase();
  if (!BIZ_SLUG_PATTERN.test(biz)) return null;
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return sequence === 1 ? `${biz}/standee` : `${biz}/standee-${sequence}`;
}

export function reservationIdentityMatches(
  reservation: { kind?: string | null; instanceId?: unknown } | null | undefined,
  kind: 'standee' | 'card',
  instanceId: unknown
): boolean {
  if (!reservation || reservation.kind !== kind) return false;
  if (reservation.instanceId === null || reservation.instanceId === undefined) return false;
  return String(reservation.instanceId) === String(instanceId);
}

/**
 * Readiness gate. New allocation is allowed only when:
 *  - the permanent path unique index exists, and
 *  - the backfill/activation marker exists.
 *
 * The marker is written only by the controlled backfill activation step. This
 * prevents a deployed-but-unbackfilled code path from allocating unsafe paths.
 */
export async function isPublicUrlReservationReady(): Promise<boolean> {
  try {
    const indexes = (await PublicUrlReservation.collection.indexes()) as Array<{
      key?: Record<string, unknown>;
      unique?: boolean;
    }>;
    const hasUniquePathIndex = indexes.some(
      (index) =>
        index.unique === true &&
        index.key !== undefined &&
        Object.keys(index.key).length === 1 &&
        index.key.path === 1
    );
    if (!hasUniquePathIndex) return false;
    return Boolean(await Counter.exists({ _id: PUBLIC_URL_RESERVATION_READY_KEY }));
  } catch {
    return false;
  }
}

export async function assertPublicUrlReservationReady(): Promise<void> {
  if (!(await isPublicUrlReservationReady())) {
    throw new PublicUrlReservationNotReadyError();
  }
}

export async function isPublicPathReserved(path: string): Promise<boolean> {
  return Boolean(await PublicUrlReservation.exists({ path }));
}

async function markReservationActive(reservationId: unknown): Promise<void> {
  await PublicUrlReservation.updateOne(
    { _id: reservationId, status: { $ne: 'active' } },
    { $set: { status: 'active', retiredAt: null } }
  ).catch(() => undefined);
}

/**
 * Reconcile an existing publicSlug with the registry. Never changes the stored
 * slug. A reservation held by another identity fails closed.
 */
export async function reconcileStandeePublicSlug(input: {
  standeeId: unknown;
  ownerId: unknown;
  publicSlug: string;
  source?: 'allocation' | 'backfill';
}): Promise<string> {
  await assertPublicUrlReservationReady();

  const parsed = parseStandeePublicSlug(input.publicSlug);
  if (!parsed) {
    throw new PublicUrlReservationConflictError(
      `Standee has a non-canonical publicSlug: ${input.publicSlug}`
    );
  }
  // The stored value must be already canonical; a normalized variant would not
  // resolve through getPublicStandeeByPublicSlug().
  if (String(input.publicSlug).trim() !== parsed.path) {
    throw new PublicUrlReservationConflictError(
      `Standee publicSlug is not stored canonically: ${input.publicSlug}`
    );
  }

  const cardCollision = await Card.exists({ publicSlug: parsed.path });
  if (cardCollision) {
    throw new PublicUrlReservationConflictError(
      `Public path is already held by a Card: ${parsed.path}`
    );
  }

  const existing = await PublicUrlReservation.findOne({ path: parsed.path });
  if (existing) {
    if (!reservationIdentityMatches(existing, 'standee', input.standeeId)) {
      throw new PublicUrlReservationConflictError(
        `Public path is reserved to a different identity: ${parsed.path}`
      );
    }
    await markReservationActive(existing._id);
    return parsed.path;
  }

  try {
    await PublicUrlReservation.create({
      path: parsed.path,
      kind: 'standee',
      instanceId: input.standeeId,
      ownerId: input.ownerId,
      status: 'active',
      source: input.source ?? 'backfill',
    });
    return parsed.path;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await PublicUrlReservation.findOne({ path: parsed.path });
    if (raced && reservationIdentityMatches(raced, 'standee', input.standeeId)) {
      await markReservationActive(raced._id);
      return parsed.path;
    }
    throw new PublicUrlReservationConflictError(
      `Public path reservation raced with another identity: ${parsed.path}`
    );
  }
}

/**
 * Allocate a new permanent path for a Standee. The reservation is inserted
 * before the Standee is updated, so a crash may leave a permanently unused path
 * but can never leave an unreserved assigned path.
 */
export async function allocateStandeePublicSlug(input: {
  standeeId: unknown;
  ownerId: unknown;
  bizSlug: string;
}): Promise<string> {
  await assertPublicUrlReservationReady();

  const standee = (await Standee.findById(input.standeeId)
    .select('_id userId publicSlug')
    .lean()) as { _id: unknown; userId?: unknown; publicSlug?: string } | null;
  if (!standee) {
    throw new PublicUrlReservationConflictError('Standee not found for publicSlug allocation');
  }
  if (standee.publicSlug) {
    return reconcileStandeePublicSlug({
      standeeId: standee._id,
      ownerId: input.ownerId,
      publicSlug: standee.publicSlug,
      source: 'allocation',
    });
  }

  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt++) {
    const sequence = await nextPermUniqueNumber(`standee-slug:${input.bizSlug}`);
    const path = standeePathForSequence(input.bizSlug, sequence);
    if (!path) {
      throw new PublicUrlReservationConflictError('Could not construct a Standee public path');
    }

    const existingReservation = await PublicUrlReservation.findOne({ path });
    if (existingReservation) {
      if (!reservationIdentityMatches(existingReservation, 'standee', standee._id)) {
        continue;
      }
    } else {
      const [cardCollision, standeeCollision] = await Promise.all([
        Card.exists({ publicSlug: path }),
        Standee.exists({ publicSlug: path, _id: { $ne: standee._id } }),
      ]);
      if (cardCollision || standeeCollision) continue;

      try {
        await PublicUrlReservation.create({
          path,
          kind: 'standee',
          instanceId: standee._id,
          ownerId: input.ownerId,
          status: 'reserved',
          source: 'allocation',
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const raced = await PublicUrlReservation.findOne({ path });
        if (!raced || !reservationIdentityMatches(raced, 'standee', standee._id)) {
          continue;
        }
      }
    }

    const update = await Standee.updateOne(
      {
        _id: standee._id,
        $or: [
          { publicSlug: { $exists: false } },
          { publicSlug: '' },
          { publicSlug: null },
        ],
      },
      { $set: { publicSlug: path } }
    );

    if (update.modifiedCount === 1) {
      const reservation = await PublicUrlReservation.findOne({ path });
      if (!reservation || !reservationIdentityMatches(reservation, 'standee', standee._id)) {
        throw new PublicUrlReservationConflictError(
          `Public path reservation identity mismatch: ${path}`
        );
      }
      await markReservationActive(reservation._id);
      return path;
    }

    const fresh = (await Standee.findById(standee._id)
      .select('publicSlug')
      .lean()) as { publicSlug?: string } | null;
    if (fresh?.publicSlug) {
      return reconcileStandeePublicSlug({
        standeeId: standee._id,
        ownerId: input.ownerId,
        publicSlug: fresh.publicSlug,
        source: 'allocation',
      });
    }
    // The Standee was not updated and still has no publicSlug. The reservation
    // created above remains permanently reserved; try the next candidate.
  }

  throw new PublicUrlReservationConflictError(
    `Could not allocate a unique Standee public path after ${MAX_ALLOCATION_ATTEMPTS} attempts`
  );
}

/**
 * Retire (never delete) a Standee's reservation. Used before deletion. If the
 * path cannot be safely reserved, deletion must fail closed.
 */
export async function retireStandeePublicSlugReservation(input: {
  standeeId: unknown;
  ownerId: unknown;
  publicSlug: string | null | undefined;
}): Promise<void> {
  if (!input.publicSlug) return;

  await assertPublicUrlReservationReady();

  const parsed = parseStandeePublicSlug(input.publicSlug);
  if (!parsed || String(input.publicSlug).trim() !== parsed.path) {
    throw new PublicUrlReservationConflictError(
      `Cannot retire a non-canonical Standee publicSlug: ${input.publicSlug}`
    );
  }

  const existing = await PublicUrlReservation.findOne({ path: parsed.path });
  if (existing) {
    if (!reservationIdentityMatches(existing, 'standee', input.standeeId)) {
      throw new PublicUrlReservationConflictError(
        `Public path is reserved to a different identity: ${parsed.path}`
      );
    }
    await PublicUrlReservation.updateOne(
      { _id: existing._id },
      { $set: { status: 'retired', retiredAt: new Date() } }
    );
    return;
  }

  const cardCollision = await Card.exists({ publicSlug: parsed.path });
  if (cardCollision) {
    throw new PublicUrlReservationConflictError(
      `Cannot reserve a path already held by a Card: ${parsed.path}`
    );
  }

  try {
    await PublicUrlReservation.create({
      path: parsed.path,
      kind: 'standee',
      instanceId: input.standeeId,
      ownerId: input.ownerId,
      status: 'retired',
      source: 'backfill',
      retiredAt: new Date(),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await PublicUrlReservation.findOne({ path: parsed.path });
    if (!raced || !reservationIdentityMatches(raced, 'standee', input.standeeId)) {
      throw new PublicUrlReservationConflictError(
        `Public path reservation conflict while retiring: ${parsed.path}`
      );
    }
    await PublicUrlReservation.updateOne(
      { _id: raced._id },
      { $set: { status: 'retired', retiredAt: new Date() } }
    );
  }
}

/**
 * Retire all reservations for an account before account deletion. Fails closed
 * before any destructive operation if a reservation cannot be preserved.
 */
export async function retireStandeeReservationsForUser(ownerId: unknown): Promise<number> {
  const standees = (await Standee.find({
    userId: ownerId,
    publicSlug: { $exists: true, $nin: ['', null] },
  })
    .select('_id userId publicSlug')
    .lean()) as Array<{ _id: unknown; userId?: unknown; publicSlug?: string }>;

  if (standees.length === 0) return 0;

  await assertPublicUrlReservationReady();

  for (const standee of standees) {
    await retireStandeePublicSlugReservation({
      standeeId: standee._id,
      ownerId: standee.userId ?? ownerId,
      publicSlug: standee.publicSlug,
    });
  }
  return standees.length;
}
