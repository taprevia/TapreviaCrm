/**
 * Phase 2A-1 permanent public URL reservation backfill.
 *
 * DRY RUN BY DEFAULT. It only inspects data and prints a conflict report.
 *
 * Write mode is deliberately restricted to a disposable local database:
 *   MONGODB_DB=taprevia_phase2a1_<anything>
 *   MONGODB_URI=mongodb://127.0.0.1|localhost/...
 *   PUBLIC_URL_RESERVATION_BACKFILL_WRITE=YES
 *   npx tsx scripts/backfill-public-url-reservations.ts --write
 *
 * Production activation requires a separately approved operational procedure.
 * This script never creates indexes, changes publicSlug values, deletes records,
 * or rewrites analytics.
 */
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Counter from '@/models/Counter';
import PublicUrlReservation from '@/models/PublicUrlReservation';
import Standee from '@/models/Standee';
import {
  PUBLIC_URL_RESERVATION_READY_KEY,
  isCanonicalStandeePublicSlug,
  parseStandeePublicSlug,
  standeeSuffixFromPublicSlug,
} from '@/lib/services/public-url-reservation';

interface LeanUrlRecord {
  _id: unknown;
  userId?: unknown;
  publicSlug?: string;
}

interface ExistingReservation {
  path: string;
  kind: string;
  instanceId?: unknown;
  ownerId?: unknown;
  status: string;
  source: string;
}

const PATH_PATTERN = /^[a-z0-9-]{1,50}\/[a-z0-9-]{1,50}$/;
const WRITE = process.argv.includes('--write');
const HISTORICAL_ARG = process.argv.find((arg) => arg.startsWith('--historical='));
const HISTORICAL_FILE = HISTORICAL_ARG?.slice('--historical='.length) || '';

function assertIsolatedWriteTarget(): void {
  if (process.env.PUBLIC_URL_RESERVATION_BACKFILL_WRITE !== 'YES') {
    throw new Error('Write mode requires PUBLIC_URL_RESERVATION_BACKFILL_WRITE=YES');
  }
  const uri = process.env.MONGODB_URI ?? '';
  const db = process.env.MONGODB_DB ?? '';
  const local =
    /mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(uri);
  if (!local || !db.startsWith('taprevia_phase2a1_')) {
    throw new Error(
      'Write mode is restricted to an isolated local DB named taprevia_phase2a1_*'
    );
  }
}

async function hasUniquePathIndex(): Promise<boolean> {
  try {
    const indexes = (await PublicUrlReservation.collection.indexes()) as Array<{
      key?: Record<string, unknown>;
      unique?: boolean;
    }>;
    return indexes.some(
      (index) =>
        index.unique === true &&
        index.key !== undefined &&
        Object.keys(index.key).length === 1 &&
        index.key.path === 1
    );
  } catch {
    return false;
  }
}

function readHistoricalPaths(): string[] {
  if (!HISTORICAL_FILE) return [];
  const raw = JSON.parse(readFileSync(HISTORICAL_FILE, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error('Historical file must be a JSON array of public paths');
  }
  return raw.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

async function main(): Promise<void> {
  if (WRITE) assertIsolatedWriteTarget();
  await connectDB();

  const indexReady = await hasUniquePathIndex();
  const standees = (await Standee.find({
    publicSlug: { $exists: true, $nin: ['', null] },
  })
    .select('_id userId publicSlug')
    .lean()) as LeanUrlRecord[];
  const cards = (await Card.find({
    publicSlug: { $exists: true, $nin: ['', null] },
  })
    .select('_id userId publicSlug')
    .lean()) as LeanUrlRecord[];
  const existing = (await PublicUrlReservation.find({})
    .select('path kind instanceId ownerId status source')
    .lean()) as unknown as ExistingReservation[];

  const reservationByPath = new Map(existing.map((row) => [row.path, row]));
  const standeeByPath = new Map<string, LeanUrlRecord>();
  const cardByPath = new Map<string, LeanUrlRecord>();
  const malformed: Array<{ kind: string; id: string; value: string }> = [];
  const duplicatePaths: Array<{ path: string; ids: string[] }> = [];
  const conflicts: string[] = [];
  const maxSuffixByBiz = new Map<string, number>();
  const historical = readHistoricalPaths();

  for (const standee of standees) {
    const value = String(standee.publicSlug ?? '').trim();
    if (!isCanonicalStandeePublicSlug(value) || value !== value.toLowerCase()) {
      malformed.push({ kind: 'standee', id: String(standee._id), value });
      continue;
    }
    const parsed = parseStandeePublicSlug(value);
    if (!parsed) continue;
    const duplicate = standeeByPath.get(parsed.path);
    if (duplicate) {
      duplicatePaths.push({ path: parsed.path, ids: [String(duplicate._id), String(standee._id)] });
      continue;
    }
    standeeByPath.set(parsed.path, standee);
    maxSuffixByBiz.set(
      parsed.bizSlug,
      Math.max(maxSuffixByBiz.get(parsed.bizSlug) ?? 0, parsed.suffix)
    );

    const reserved = reservationByPath.get(parsed.path);
    if (reserved) {
      if (
        reserved.kind !== 'standee' ||
        String(reserved.instanceId ?? '') !== String(standee._id)
      ) {
        conflicts.push(`Standee ${standee._id}: reservation ${parsed.path} belongs to another identity`);
      }
    }
  }

  for (const card of cards) {
    const value = String(card.publicSlug ?? '').trim();
    if (!PATH_PATTERN.test(value) || value !== value.toLowerCase()) {
      malformed.push({ kind: 'card', id: String(card._id), value });
      continue;
    }
    const duplicate = cardByPath.get(value);
    if (duplicate) {
      duplicatePaths.push({ path: value, ids: [String(duplicate._id), String(card._id)] });
      continue;
    }
    cardByPath.set(value, card);
    if (standeeByPath.has(value)) {
      conflicts.push(`Card/Standee path collision: ${value}`);
    }
    const reserved = reservationByPath.get(value);
    if (reserved && reserved.kind === 'standee') {
      conflicts.push(`Card ${card._id} occupies a reserved Standee path: ${value}`);
    }
  }

  const historicalCandidates: string[] = [];
  for (const path of historical) {
    if (!isCanonicalStandeePublicSlug(path)) {
      malformed.push({ kind: 'historical', id: '', value: path });
      continue;
    }
    const parsed = parseStandeePublicSlug(path);
    if (!parsed) continue;
    maxSuffixByBiz.set(
      parsed.bizSlug,
      Math.max(maxSuffixByBiz.get(parsed.bizSlug) ?? 0, parsed.suffix)
    );
    if (cardByPath.has(path)) {
      conflicts.push(`Historical Standee path collides with a Card: ${path}`);
      continue;
    }
    if (reservationByPath.has(path) || standeeByPath.has(path)) continue;
    historicalCandidates.push(path);
  }

  const report = {
    writeMode: WRITE,
    indexReady,
    standeesWithPublicSlug: standees.length,
    cardsWithPublicSlug: cards.length,
    existingReservations: existing.length,
    malformed,
    duplicatePaths,
    conflicts,
    historicalCandidates: historicalCandidates.length,
    counterSeeds: [...maxSuffixByBiz.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bizSlug, maxSuffix]) => ({ bizSlug, maxSuffix })),
  };

  console.log(JSON.stringify(report, null, 2));

  if (!WRITE) {
    console.log('\nDRY RUN ONLY — no database writes were performed.');
    await mongoose.disconnect();
    return;
  }

  if (!indexReady) {
    throw new Error(
      'Unique PublicUrlReservation.path index is missing. Create it via the approved index procedure first.'
    );
  }
  if (conflicts.length > 0 || malformed.length > 0 || duplicatePaths.length > 0) {
    throw new Error('Conflicts or malformed paths exist; no writes performed and readiness was not set.');
  }

  for (const standee of standeeByPath.values()) {
    const path = String(standee.publicSlug ?? '').trim();
    const parsed = parseStandeePublicSlug(path);
    if (!parsed) continue;
    await PublicUrlReservation.updateOne(
      { path },
      {
        $setOnInsert: {
          path,
          kind: 'standee',
          instanceId: standee._id,
          ownerId: standee.userId ?? null,
          status: 'active',
          source: 'backfill',
          issuedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  for (const path of historicalCandidates) {
    await PublicUrlReservation.updateOne(
      { path },
      {
        $setOnInsert: {
          path,
          kind: 'standee',
          instanceId: null,
          ownerId: null,
          status: 'retired',
          source: 'backfill',
          issuedAt: new Date(),
          retiredAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  for (const [bizSlug, maxSuffix] of maxSuffixByBiz.entries()) {
    await Counter.updateOne(
      { _id: `standee-slug:${bizSlug}` },
      { $max: { seq: maxSuffix } },
      { upsert: true }
    );
  }

  await Counter.updateOne(
    { _id: PUBLIC_URL_RESERVATION_READY_KEY },
    { $set: { seq: 1 } },
    { upsert: true }
  );

  console.log('\nActivation completed for the isolated database.');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});
