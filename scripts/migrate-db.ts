/**
 * migrate-db.ts — owner-controlled database copy utility.
 *
 * SAFETY MODEL:
 *   - Dry-run is the default; nothing is written without --write.
 *   - Source and target database names are REQUIRED arguments; there are no
 *     implicit `test`, `taprevia_V2` or `taprevia_backup` defaults.
 *   - The URI database path must agree with --source-db.
 *   - Remote/Atlas clusters are refused unless both --allow-remote and
 *     --confirm-remote are supplied.
 *   - Unknown arguments and duplicate/conflicting targets are rejected.
 *   - A sanitized summary is printed before any connection is opened.
 *
 * With --write, upserts by `_id` may create target databases/collections.
 * The source is opened read-only.
 *
 * Usage:
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm \
 *     npx tsx scripts/migrate-db.ts \
 *     --source-db=nfc-crm --target-db=nfc-crm_copy --write
 *
 * Remote (owner approval required):
 *   MONGODB_URI=mongodb+srv://... npx tsx scripts/migrate-db.ts \
 *     --source-db=<src> --target-db=<dst> \
 *     --allow-remote --confirm-remote --write
 */

import {
  MongoClient,
  type AnyBulkWriteOperation,
  type Db,
  type Document,
} from 'mongodb';
import {
  OpsScriptSafetyError,
  formatTargetSummary,
  parseMigrationArgs,
  parseMongoTarget,
  type MigrationArgs,
  type MongoScriptTarget,
} from '../src/lib/ops-script-safety';

const BATCH_SIZE = Math.max(1, Number(process.env.BATCH_SIZE ?? 500));

const LOG_PREFIX = '[db-migrate]';

/** A single `_id`-keyed upsert operation. */
type UpsertOp = AnyBulkWriteOperation<Document>;

interface FlushResult {
  inserted: number;
  updated: number;
  failed: number;
}

interface Totals {
  inserted: number;
  updated: number;
  failed: number;
}

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function warn(message: string): void {
  console.warn(`${LOG_PREFIX} ${message}`);
}

function error(message: string): void {
  console.error(`${LOG_PREFIX} ${message}`);
}

/** Flush one batch of upserts into a target collection. */
async function flush(
  db: Db,
  collection: string,
  ops: UpsertOp[]
): Promise<FlushResult> {
  if (ops.length === 0) return { inserted: 0, updated: 0, failed: 0 };

  try {
    const result = await db.collection(collection).bulkWrite(ops, { ordered: false });
    return {
      inserted: result.upsertedCount ?? 0,
      updated: result.modifiedCount ?? 0,
      failed: Math.max(0, ops.length - ((result.upsertedCount ?? 0) + (result.matchedCount ?? 0))),
    };
  } catch (err) {
    // ordered:false → the batch is partially applied. Recover the counts the
    // driver reports and count the rest as failed so the run can continue.
    const bulkError = err as {
      result?: { upsertedCount?: number; matchedCount?: number };
      writeErrors?: Array<{ err?: { message?: string }; errmsg?: string }>;
    };
    const inserted = bulkError.result?.upsertedCount ?? 0;
    const matched = bulkError.result?.matchedCount ?? 0;
    const failed = Math.max(0, ops.length - (inserted + matched));
    const firstError =
      bulkError.writeErrors?.[0]?.err?.message ?? bulkError.writeErrors?.[0]?.errmsg;
    warn(
      `${collection}: ${failed} operation(s) failed in a batch of ${ops.length}` +
        (firstError ? ` — ${firstError}` : '')
    );
    return { inserted, updated: 0, failed };
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    error('MONGODB_URI is not set. Refusing to run without an explicit connection string.');
    process.exit(1);
  }

  let args: MigrationArgs;
  try {
    args = parseMigrationArgs(process.argv.slice(2));
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  let target: MongoScriptTarget;
  try {
    // The explicit source is also checked against the URI path. A URI that
    // silently points at another database is refused.
    target = parseMongoTarget(uri, args.source);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (target.isRemote && !args.allowRemote) {
    error(
      'Refusing a remote MongoDB target. Re-run with --allow-remote only after owner approval.'
    );
    process.exit(1);
  }
  if (target.isRemote && !args.confirmRemote) {
    error(
      `Remote access to "${target.dbName}" is not confirmed. Pass --confirm-remote as a second explicit signal.`
    );
    process.exit(1);
  }

  const DRY_RUN = !args.write;
  const SOURCE_DB = args.source;
  const TARGET_DB_NAMES = args.targets;

  log(
    `operation=${DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE'} ` +
      `source=${SOURCE_DB} targets=[${TARGET_DB_NAMES.join(', ')}] ${formatTargetSummary(target)}`
  );
  if (!DRY_RUN) {
    log('Write confirmation received. This operation will upsert documents by _id.');
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });

  const totals: Totals = { inserted: 0, updated: 0, failed: 0 };

  try {
    log('connecting to cluster...');
    await client.connect();
    log(`connected. source="${SOURCE_DB}" (read-only) targets=[${TARGET_DB_NAMES.join(', ')}]`);
    if (DRY_RUN) log('DRY RUN — no writes will be performed.');

    const sourceDb = client.db(SOURCE_DB);
    const targetDbs = TARGET_DB_NAMES.map((name) => ({ name, db: client.db(name) }));

    // Requirement 2: discover collection names dynamically from the source.
    const discovered = await sourceDb.listCollections().toArray();
    const collectionNames = discovered
      .filter((info) => info.type === 'collection' && !info.name.startsWith('system.'))
      .map((info) => info.name)
      .sort();

    const skipped = discovered
      .filter((info) => info.type !== 'collection' || info.name.startsWith('system.'))
      .map((info) => info.name);

    if (skipped.length > 0) {
      log(`skipping non-collection entries: ${skipped.join(', ')}`);
    }
    if (collectionNames.length === 0) {
      warn(`source "${SOURCE_DB}" has no collections — nothing to migrate.`);
      return;
    }
    log(`discovered ${collectionNames.length} collection(s) in "${SOURCE_DB}"`);

    for (const name of collectionNames) {
      const sourceCollection = sourceDb.collection(name);
      const estimated = await sourceCollection.estimatedDocumentCount();
      log(`→ ${name}: processing (~${estimated} document(s) estimated)`);

      const buffers = targetDbs.map(() => [] as UpsertOp[]);
      const perTarget: Totals[] = targetDbs.map(() => ({ inserted: 0, updated: 0, failed: 0 }));
      let seen = 0;

      const flushAll = async (batchLabel: string): Promise<void> => {
        for (let i = 0; i < targetDbs.length; i += 1) {
          const ops = buffers[i];
          if (ops.length === 0) continue;

          if (DRY_RUN) {
            perTarget[i].updated += ops.length;
          } else {
            const result = await flush(targetDbs[i].db, name, ops);
            perTarget[i].inserted += result.inserted;
            perTarget[i].updated += result.updated;
            perTarget[i].failed += result.failed;
          }
          ops.length = 0;
        }
        if (batchLabel) log(`  ${name}: ${batchLabel}`);
      };

      // Requirement 4: read-only cursor against the source collection.
      for await (const doc of sourceCollection.find({})) {
        seen += 1;
        const { _id, ...rest } = doc as Document & { _id: unknown };

        // `_id` is immutable — it is only ever used as the filter key. On
        // insert, MongoDB copies it from the filter, so we must NOT include it
        // inside `$set`.
        const op = {
          updateOne: { filter: { _id }, update: { $set: rest }, upsert: true },
        } as UpsertOp;

        for (const buffer of buffers) {
          buffer.push(op);
        }

        if (seen % BATCH_SIZE === 0) {
          await flushAll(
            `${seen} document(s) ${DRY_RUN ? 'scanned' : 'upserted'}`
          );
        }
      }

      await flushAll('');

      for (let i = 0; i < targetDbs.length; i += 1) {
        const t = perTarget[i];
        totals.inserted += t.inserted;
        totals.updated += t.updated;
        totals.failed += t.failed;
        log(
          `✓ ${name} → ${targetDbs[i].name}: seen=${seen}, ` +
            `inserted=${t.inserted}, updated=${t.updated}, failed=${t.failed}`
        );
      }
    }

    log(
      `SUMMARY ${DRY_RUN ? '(dry-run) ' : ''}— ` +
        `inserted=${totals.inserted}, updated=${totals.updated}, failed=${totals.failed}`
    );
    if (totals.failed > 0) {
      error(`${totals.failed} operation(s) failed — review the warnings above.`);
      process.exitCode = 1;
    }
  } catch (err) {
    error(`migration crashed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  } finally {
    await client.close().catch(() => undefined);
    log('connection closed.');
  }
}

main().catch((err) => {
  if (err instanceof OpsScriptSafetyError) {
    error(err.message);
  } else {
    console.error('Migration crashed:', err);
  }
  process.exit(2);
});
