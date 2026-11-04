/**
 * migrate-remove-legacy-nfc-card.ts
 *
 * Removes ONLY the confirmed legacy duplicate catalog product:
 *
 *   _id  : 6a8e70e8c6d1bfed0bd99d7a
 *   slug : nfc-card
 *   name : NFC Business Card
 *   kind : null
 *
 * Canonical product that must remain untouched:
 *
 *   _id  : 6ae851d69391bf20babb51f0
 *   slug : business-nfc-card
 *   name : Business NFC Card
 *   kind : profile
 *
 * What it does (idempotent):
 *   1. Asserts the exact legacy + canonical records.
 *   2. Repoints only assignments whose `catalogProductId` is the exact legacy
 *      ObjectId to the canonical ObjectId. Assignment `_id`, card, user,
 *      billing fields, status, quantity, createdAt and assignedBy are preserved.
 *   3. Re-scans every collection for the legacy ObjectId / exact slug.
 *   4. Deletes exactly one document, guarded by _id + slug + name.
 *   5. Re-verifies references, canonical record, and both customer cards.
 *
 * Safety:
 *   - Dry-run by default; `--apply` is required to write.
 *   - Refuses the live `nfc-crm` database unless `--allow-live-destructive`
 *     is passed (never use that during isolated verification).
 *   - Refuses unknown database names.
 *
 * Usage (isolated clone):
 *   MONGODB_URI=mongodb://127.0.0.1:27017/<clone> \
 *     npx tsx scripts/migrate-remove-legacy-nfc-card.ts --apply
 *
 * Rollback (isolated or approved live):
 *   MONGODB_URI=mongodb://127.0.0.1:27017/<clone> \
 *     npx tsx scripts/migrate-remove-legacy-nfc-card.ts --rollback <backupDir> --apply
 *
 * The backup directory must contain `target-product.json` and
 * `target-assignments.json` (created by the removal backup step).
 */

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';

const TARGET_ID = new ObjectId('6a8e70e8c6d1bfed0bd99d7a');
const TARGET_SLUG = 'nfc-card';
const TARGET_NAME = 'NFC Business Card';

const CANONICAL_ID = new ObjectId('6ae851d69391bf20babb51f0');
const CANONICAL_SLUG = 'business-nfc-card';
const CANONICAL_NAME = 'Business NFC Card';

const ISOLATED_DB_PREFIXES = ['legacy_nfc_removal_clone_', 'nfc-crm-', 'branddeep_'];
const LIVE_DB = 'nfc-crm';

interface Args {
  apply: boolean;
  allowLive: boolean;
  rollbackDir: string | null;
  backupDir: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const rollbackIndex = argv.indexOf('--rollback');
  const backupIndex = argv.indexOf('--backup-dir');
  return {
    apply: argv.includes('--apply'),
    allowLive: argv.includes('--allow-live-destructive'),
    rollbackDir: rollbackIndex >= 0 ? argv[rollbackIndex + 1] ?? null : null,
    backupDir: backupIndex >= 0 ? argv[backupIndex + 1] ?? null : null,
  };
}

function fail(message: string): never {
  console.error(`\nSTOP: ${message}`);
  process.exit(1);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function dbNameFromUri(uri: string): string {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const slash = withoutScheme.indexOf('/');
  if (slash < 0) return '';
  const after = withoutScheme.slice(slash + 1);
  const query = after.indexOf('?');
  return decodeURIComponent((query >= 0 ? after.slice(0, query) : after) || '');
}

async function guardDatabase(db: Db, uri: string, args: Args): Promise<void> {
  const name = db.databaseName;
  assert(name, 'database name is empty');
  assert(name === dbNameFromUri(uri), `resolved database ${name} does not match MONGODB_URI`);

  if (name === LIVE_DB) {
    assert(
      !args.apply || args.allowLive,
      `refusing destructive run against live database "${LIVE_DB}" without --allow-live-destructive`
    );
    return;
  }

  assert(
    ISOLATED_DB_PREFIXES.some((prefix) => name.startsWith(prefix)),
    `refusing unknown database "${name}" (expected an isolated clone prefix)`
  );
}

function mask(value: unknown): string {
  return String(value ?? '').slice(-6);
}

/** Recursively collect paths whose value embeds the legacy ObjectId or slug. */
function findTargetPaths(value: unknown, trail: string[] = []): string[] {
  if (value === null || value === undefined) return [];
  if (value instanceof ObjectId) {
    return value.equals(TARGET_ID) ? [trail.join('.') || '(root)'] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findTargetPaths(entry, [...trail, String(index)]));
  }
  if (value instanceof Date) return [];
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      findTargetPaths(entry, [...trail, key])
    );
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    const candidate = raw.toLowerCase();
    if (
      candidate === TARGET_ID.toHexString().toLowerCase() ||
      candidate === TARGET_SLUG ||
      raw === TARGET_NAME
    ) {
      return [trail.join('.') || '(root)'];
    }
  }
  return [];
}

/**
 * Finds blocking legacy references. Display-only customer content is reported
 * separately: a card's `cardLabel` may legitimately say "NFC Business Card"
 * and must not be rewritten.
 */
async function scanReferences(db: Db): Promise<
  Array<{ collection: string; documentId: string; paths: string[]; displayOnly: boolean }>
> {
  const collections = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  const hits: Array<{
    collection: string;
    documentId: string;
    paths: string[];
    displayOnly: boolean;
  }> = [];

  for (const collection of collections) {
    const docs = await db.collection(collection).find({}).toArray();
    for (const doc of docs) {
      if (collection === 'catalogproducts' && String(doc._id) === TARGET_ID.toHexString()) {
        // The target itself is expected pre-deletion and reported by the caller.
        continue;
      }
      const paths = findTargetPaths(doc);
      if (paths.length === 0) continue;
      const displayOnly = paths.every((p) => p === 'cardLabel');
      hits.push({
        collection,
        documentId: String(doc._id),
        paths,
        displayOnly,
      });
    }
  }

  return hits;
}

function pickAssignmentFields(doc: Document): Record<string, unknown> {
  return {
    _id: doc._id,
    userId: doc.userId,
    catalogProductId: doc.catalogProductId,
    cardId: doc.cardId,
    standeeId: doc.standeeId ?? null,
    status: doc.status,
    quantity: doc.quantity,
    unitPriceMinor: doc.unitPriceMinor,
    createdAt: doc.createdAt,
    assignedBy: doc.assignedBy ?? null,
  };
}

async function assertCanonical(db: Db): Promise<Document> {
  const canonical = await db.collection('catalogproducts').findOne({ _id: CANONICAL_ID });
  assert(canonical, `canonical product ${CANONICAL_ID.toHexString()} not found`);
  assert(canonical.slug === CANONICAL_SLUG, `canonical slug mismatch: ${canonical.slug}`);
  assert(canonical.name === CANONICAL_NAME, `canonical name mismatch: ${canonical.name}`);
  assert(canonical.kind === 'profile', `canonical kind mismatch: ${canonical.kind}`);
  assert(canonical.active === true, 'canonical product is not active');
  return canonical;
}

async function writeBackup(db: Db, dir: string, target: Document | null, assignments: Document[]): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'target-product.json'), JSON.stringify(target, null, 2));
  fs.writeFileSync(path.join(dir, 'target-assignments.json'), JSON.stringify(assignments, null, 2));
  console.log(`Backup written to ${dir}`);
}

async function migrate(db: Db, args: Args): Promise<void> {
  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  const canonicalBefore = await assertCanonical(db);

  const target = await db.collection('catalogproducts').findOne({ _id: TARGET_ID });
  const legacyAssignments = await db
    .collection('userproducts')
    .find({ catalogProductId: TARGET_ID })
    .sort({ _id: 1 })
    .toArray();

  if (!target) {
    // Idempotent success path: the product is already gone.
    assert(
      legacyAssignments.length === 0,
      `legacy product is absent but ${legacyAssignments.length} assignment(s) still reference ${TARGET_ID.toHexString()}`
    );
    const blocking = (await scanReferences(db)).filter((hit) => !hit.displayOnly);
    assert(
      blocking.length === 0,
      `legacy product is absent but references remain: ${JSON.stringify(blocking)}`
    );
    console.log('Already applied: legacy product and references are absent. No changes made.');
    return;
  }

  assert(target.slug === TARGET_SLUG, `target slug mismatch: expected ${TARGET_SLUG}, got ${target.slug}`);
  assert(target.name === TARGET_NAME, `target name mismatch: expected ${TARGET_NAME}, got ${target.name}`);
  assert((target.kind ?? null) === null, `target kind mismatch: expected null, got ${target.kind}`);

  console.log(
    `Legacy product verified: _id=${target._id.toHexString()} slug=${target.slug} name=${target.name} kind=null`
  );
  console.log(`Assignments to migrate: ${legacyAssignments.length}`);

  for (const assignment of legacyAssignments) {
    const summary = pickAssignmentFields(assignment);
    console.log(`  assignment ${mask(summary._id)} card ${mask(summary.cardId)} status ${summary.status}`);
    assert(assignment.cardId, `assignment ${assignment._id} has no cardId`);

    const sameCardDuplicate = await db.collection('userproducts').findOne({
      _id: { $ne: assignment._id },
      userId: assignment.userId,
      catalogProductId: CANONICAL_ID,
      cardId: assignment.cardId,
      status: 'active',
    });
    assert(
      !sameCardDuplicate,
      `assignment ${assignment._id} would duplicate canonical assignment ${sameCardDuplicate?._id} for the same card`
    );
  }

  const blockingBefore = (await scanReferences(db)).filter((hit) => !hit.displayOnly);
  for (const hit of blockingBefore) {
    console.log(`  reference: ${hit.collection}/${mask(hit.documentId)} at ${hit.paths.join(', ')}`);
  }
  const unexpected = blockingBefore.filter((hit) => hit.collection !== 'userproducts');
  assert(
    unexpected.length === 0,
    `unexpected legacy references outside userproducts: ${JSON.stringify(unexpected)}`
  );

  if (args.backupDir) {
    await writeBackup(db, args.backupDir, target, legacyAssignments);
  }

  if (!args.apply) {
    console.log('\nDry run complete. No writes performed. Re-run with --apply to migrate.');
    return;
  }

  let migrated = 0;
  for (const assignment of legacyAssignments) {
    const result = await db.collection('userproducts').updateOne(
      { _id: assignment._id, catalogProductId: TARGET_ID },
      { $set: { catalogProductId: CANONICAL_ID, updatedAt: new Date() } }
    );
    assert(result.matchedCount === 1, `assignment ${assignment._id} disappeared during migration`);
    assert(result.modifiedCount === 1, `assignment ${assignment._id} was not modified`);
    migrated += 1;
  }
  console.log(`Migrated assignments: ${migrated}`);

  const remainingAssignments = await db
    .collection('userproducts')
    .countDocuments({ catalogProductId: TARGET_ID });
  assert(remainingAssignments === 0, `${remainingAssignments} assignment(s) still reference the legacy product`);

  const blockingAfter = (await scanReferences(db)).filter((hit) => !hit.displayOnly);
  assert(
    blockingAfter.length === 0,
    `legacy references remain after assignment migration: ${JSON.stringify(blockingAfter)}`
  );

  const deletion = await db.collection('catalogproducts').deleteOne({
    _id: TARGET_ID,
    slug: TARGET_SLUG,
    name: TARGET_NAME,
  });
  assert(deletion.deletedCount === 1, `expected exactly 1 deleted product, got ${deletion.deletedCount}`);
  console.log('Deleted legacy catalog product: 1 document');

  // Post-deletion assertions.
  const targetAfter = await db.collection('catalogproducts').findOne({ _id: TARGET_ID });
  assert(!targetAfter, 'legacy product still exists after deletion');

  const canonicalAfter = await assertCanonical(db);
  assert(
    JSON.stringify(canonicalAfter) === JSON.stringify(canonicalBefore),
    'canonical product document changed during migration'
  );

  const remainingRefs = (await scanReferences(db)).filter((hit) => !hit.displayOnly);
  assert(remainingRefs.length === 0, `references remain after deletion: ${JSON.stringify(remainingRefs)}`);

  for (const assignment of legacyAssignments) {
    const current = await db.collection('userproducts').findOne({ _id: assignment._id });
    assert(current, `assignment ${assignment._id} missing after migration`);
    assert(
      String(current.catalogProductId) === CANONICAL_ID.toHexString(),
      `assignment ${assignment._id} not repointed`
    );
    for (const field of ['userId', 'cardId', 'status', 'quantity', 'unitPriceMinor', 'createdAt', 'assignedBy']) {
      assert(
        JSON.stringify(current[field] ?? null) === JSON.stringify(assignment[field] ?? null),
        `assignment ${assignment._id} field ${field} changed`
      );
    }

    const card = await db.collection('cards').findOne({ _id: assignment.cardId });
    assert(card, `card ${assignment.cardId} missing after migration`);
    assert(
      String(card.userId) === String(assignment.userId),
      `card ${assignment.cardId} ownership changed`
    );
    console.log(
      `Preserved card ${mask(card._id)} routeSlug=${card.routeSlug} urlAlias=${card.urlAlias} publicSlug=${card.publicSlug ?? 'null'}`
    );
  }

  console.log('\nMigration applied successfully.');
}

async function rollback(db: Db, backupDir: string, apply: boolean): Promise<void> {
  const productFile = path.join(backupDir, 'target-product.json');
  const assignmentFile = path.join(backupDir, 'target-assignments.json');
  assert(fs.existsSync(productFile), `missing ${productFile}`);
  assert(fs.existsSync(assignmentFile), `missing ${assignmentFile}`);

  const product = JSON.parse(fs.readFileSync(productFile, 'utf8')) as Document;
  const assignments = JSON.parse(fs.readFileSync(assignmentFile, 'utf8')) as Document[];

  assert(String(product._id) === TARGET_ID.toHexString(), 'backup product has unexpected _id');
  assert(product.slug === TARGET_SLUG, 'backup product has unexpected slug');
  assert(product.name === TARGET_NAME, 'backup product has unexpected name');

  const restoreProduct: Document = {
    ...product,
    _id: new ObjectId(String(product._id)),
    createdAt: new Date(String(product.createdAt)),
    updatedAt: new Date(String(product.updatedAt)),
  };

  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(`Mode: ${apply ? 'APPLY ROLLBACK' : 'DRY RUN ROLLBACK'}`);
  console.log(`Backup: ${backupDir}`);

  await assertCanonical(db);

  const existing = await db.collection('catalogproducts').findOne({ _id: TARGET_ID });
  if (existing) {
    assert(existing.slug === TARGET_SLUG && existing.name === TARGET_NAME, 'existing target record mismatch');
    console.log('Legacy product already present.');
  } else {
    console.log('Legacy product will be restored from backup.');
  }

  for (const assignment of assignments) {
    const current = await db.collection('userproducts').findOne({ _id: new ObjectId(String(assignment._id)) });
    assert(current, `assignment ${assignment._id} not found; cannot roll back`);
    assert(
      String(current.cardId) === String(assignment.cardId),
      `assignment ${assignment._id} cardId changed; refusing rollback`
    );
  }

  if (!apply) {
    console.log('Dry run complete. No writes performed. Re-run with --apply to roll back.');
    return;
  }

  if (!existing) {
    await db.collection('catalogproducts').insertOne(restoreProduct);
    console.log('Restored legacy catalog product.');
  }

  for (const assignment of assignments) {
    const result = await db.collection('userproducts').updateOne(
      { _id: new ObjectId(String(assignment._id)) },
      {
        $set: {
          catalogProductId: new ObjectId(String(assignment.catalogProductId)),
          updatedAt: assignment.updatedAt ? new Date(String(assignment.updatedAt)) : new Date(),
        },
      }
    );
    assert(result.matchedCount === 1, `assignment ${assignment._id} vanished during rollback`);
    console.log(`Restored assignment ${mask(assignment._id)} -> legacy product ${mask(assignment.catalogProductId)}`);
  }

  const restored = await db.collection('catalogproducts').findOne({ _id: TARGET_ID });
  assert(restored, 'legacy product missing after rollback');
  assert(restored.slug === TARGET_SLUG && restored.name === TARGET_NAME, 'restored product identity mismatch');

  for (const assignment of assignments) {
    const current = await db.collection('userproducts').findOne({ _id: new ObjectId(String(assignment._id)) });
    assert(
      String(current?.catalogProductId) === String(assignment.catalogProductId),
      `assignment ${assignment._id} not restored`
    );
    const card = await db.collection('cards').findOne({ _id: new ObjectId(String(assignment.cardId)) });
    assert(card, `card ${assignment.cardId} missing after rollback`);
  }

  console.log('\nRollback applied successfully. Cards were not modified.');
}

async function main(): Promise<void> {
  const args = parseArgs();
  const uri = process.env.MONGODB_URI;
  assert(uri, 'MONGODB_URI is required');
  assert(/^mongodb(\+srv)?:\/\//.test(uri), 'MONGODB_URI must be a MongoDB URI');
  assert(!/mongodb\.net/i.test(uri), 'refusing Atlas/production URI');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    await guardDatabase(db, uri, args);
    if (args.rollbackDir) {
      await rollback(db, path.resolve(args.rollbackDir), args.apply);
    } else {
      await migrate(db, args);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
