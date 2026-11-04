/**
 * remove-legacy-nfc-card-account.ts
 *
 * Complete removal of ONE legacy NFC business-card account:
 *
 *   user       : prince@gmail.com / 6ae85874efc853c66c8a10f3
 *   card       : 6ae85874efc853c66c8a1112 / NFC Business Card
 *   assignment : 6ae85874efc853c66c8a1118
 *   product    : 6a8e70e8c6d1bfed0bd99d7a / nfc-card / kind:null
 *
 * Protected (never touched):
 *   canonical card     6ae85874efc853c66c8a10fe
 *   canonical product  6ae851d69391bf20babb51f0 / business-nfc-card
 *
 * Deletion plan (exact documents only, no cascade):
 *   1. delete the assignment
 *   2. delete the card
 *   3. delete the catalog product
 *
 * No other collection is modified. The shared customer Profile, User, other
 * cards, other assignments, standees, reviews, leads and analytics are kept.
 *
 * Safety:
 *   - dry-run by default; `--apply` required to write
 *   - refuses Atlas/production URIs
 *   - refuses live `nfc-crm` writes without --allow-live-destructive
 *   - refuses to delete if any unexpected document references the trio
 *   - rollback restores the exact three documents from backup
 *
 * Usage (isolated clone):
 *   MONGODB_URI=mongodb://127.0.0.1:27017/<clone> \
 *     npx tsx scripts/remove-legacy-nfc-card-account.ts --apply
 *
 * Rollback:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/<clone> \
 *     npx tsx scripts/remove-legacy-nfc-card-account.ts \
 *       --rollback <backupDir> --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId, type Db, type Document } from 'mongodb';

const CARD_ID = new ObjectId('6ae85874efc853c66c8a1112');
const ASSIGNMENT_ID = new ObjectId('6ae85874efc853c66c8a1118');
const PRODUCT_ID = new ObjectId('6a8e70e8c6d1bfed0bd99d7a');
const USER_ID = new ObjectId('6ae85874efc853c66c8a10f3');

const CARD_LABEL = 'NFC Business Card';
const ROUTE_SLUG = 'mvz27lrzva';
const URL_ALIAS = 'digital-mvz27lryec';
const CARD_UID = 'DIGITAL-MVZ27LRYEC';
const PRODUCT_SLUG = 'nfc-card';
const PRODUCT_NAME = 'NFC Business Card';
const USER_EMAIL = 'prince@gmail.com';

const CANONICAL_CARD_ID = new ObjectId('6ae85874efc853c66c8a10fe');
const CANONICAL_PRODUCT_ID = new ObjectId('6ae851d69391bf20babb51f0');
const CANONICAL_PRODUCT_SLUG = 'business-nfc-card';
const CANONICAL_CARD_ROUTE = 'mvz27lr78k';
const CANONICAL_CARD_PUBLIC_SLUG = 'kaka-pvc/business-card';

const LIVE_DB = 'nfc-crm';
const ISOLATED_PREFIXES = ['legacy_card_removal_clone_', 'legacy_nfc_removal_clone_', 'nfc-crm-', 'branddeep_'];

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
    ISOLATED_PREFIXES.some((prefix) => name.startsWith(prefix)),
    `refusing unknown database "${name}" (expected an isolated clone prefix)`
  );
}

function mask(value: unknown): string {
  return String(value ?? '').slice(-6);
}

const NEEDLES = [
  CARD_ID.toHexString(),
  ASSIGNMENT_ID.toHexString(),
  PRODUCT_ID.toHexString(),
  ROUTE_SLUG,
  URL_ALIAS,
  CARD_UID,
  PRODUCT_SLUG,
  PRODUCT_NAME,
];

function findPaths(value: unknown, trail: string[] = []): Array<{ path: string; needle: string }> {
  if (value === null || value === undefined) return [];
  if (value instanceof ObjectId) {
    return NEEDLES.includes(value.toHexString())
      ? [{ path: trail.join('.') || '(root)', needle: value.toHexString() }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findPaths(entry, [...trail, String(index)]));
  }
  if (value instanceof Date) return [];
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      findPaths(entry, [...trail, key])
    );
  }
  if (typeof value === 'string') {
    const raw = value.trim();
    const lower = raw.toLowerCase();
    const needle = NEEDLES.find((candidate) => candidate.toLowerCase() === lower);
    return needle ? [{ path: trail.join('.') || '(root)', needle }] : [];
  }
  return [];
}

interface ReferenceHit {
  collection: string;
  documentId: string;
  paths: Array<{ path: string; needle: string }>;
}

async function scanReferences(db: Db): Promise<ReferenceHit[]> {
  const collections = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  const hits: ReferenceHit[] = [];
  for (const collection of collections) {
    const docs = await db.collection(collection).find({}).toArray();
    for (const doc of docs) {
      const paths = findPaths(doc);
      if (paths.length) {
        hits.push({ collection, documentId: String(doc._id), paths });
      }
    }
  }
  return hits;
}

function isTargetDocument(hit: ReferenceHit): boolean {
  if (hit.collection === 'cards' && hit.documentId === CARD_ID.toHexString()) return true;
  if (hit.collection === 'userproducts' && hit.documentId === ASSIGNMENT_ID.toHexString()) return true;
  if (hit.collection === 'catalogproducts' && hit.documentId === PRODUCT_ID.toHexString()) return true;
  return false;
}

function hydrate(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((entry) => hydrate(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        hydrate(child, childKey),
      ])
    );
  }
  if (typeof value === 'string') {
    if (['_id', 'userId', 'assignedUserId', 'cardId', 'catalogProductId', 'standeeId', 'assignedBy', 'reviewSettingsUpdatedBy'].includes(key) && /^[a-f0-9]{24}$/i.test(value)) {
      return new ObjectId(value);
    }
    if (['createdAt', 'updatedAt', 'reviewSettingsUpdatedAt', 'dateOfBirth'].includes(key) && !Number.isNaN(Date.parse(value))) {
      return new Date(value);
    }
  }
  return value;
}

function readBackup(backupDir: string): {
  card: Document;
  assignment: Document;
  product: Document;
} {
  const read = (name: string) => {
    const file = path.join(backupDir, name);
    assert(fs.existsSync(file), `missing backup file ${file}`);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Document;
  };
  return {
    card: read('target-card.json'),
    assignment: read('target-assignment.json'),
    product: read('target-product.json'),
  };
}

async function assertProtected(db: Db): Promise<{ canonicalCard: Document; canonicalProduct: Document }> {
  const canonicalCard = await db.collection('cards').findOne({ _id: CANONICAL_CARD_ID });
  assert(canonicalCard, 'canonical card not found');
  assert(canonicalCard.routeSlug === CANONICAL_CARD_ROUTE, `canonical routeSlug mismatch: ${canonicalCard.routeSlug}`);
  assert(canonicalCard.publicSlug === CANONICAL_CARD_PUBLIC_SLUG, `canonical publicSlug mismatch: ${canonicalCard.publicSlug}`);
  assert(String(canonicalCard.userId) === USER_ID.toHexString(), 'canonical card user mismatch');

  const canonicalProduct = await db.collection('catalogproducts').findOne({ _id: CANONICAL_PRODUCT_ID });
  assert(canonicalProduct, 'canonical product not found');
  assert(canonicalProduct.slug === CANONICAL_PRODUCT_SLUG, `canonical slug mismatch: ${canonicalProduct.slug}`);
  assert(canonicalProduct.name === 'Business NFC Card', `canonical name mismatch: ${canonicalProduct.name}`);
  assert(canonicalProduct.kind === 'profile', `canonical kind mismatch: ${canonicalProduct.kind}`);
  assert(canonicalProduct.active === true, 'canonical product is not active');

  return { canonicalCard, canonicalProduct };
}

async function assertTargets(db: Db): Promise<{ card: Document; assignment: Document; product: Document; user: Document }> {
  const user = await db.collection('users').findOne({ _id: USER_ID, email: USER_EMAIL });
  assert(user, 'customer not found by exact id + email');
  assert(user.role === 'customer' && user.status === 'active', 'customer is not an active customer');

  const card = await db.collection('cards').findOne({ _id: CARD_ID });
  assert(card, 'legacy card not found');
  assert(String(card.userId) === USER_ID.toHexString(), 'legacy card user mismatch');
  assert(String(card.assignedUserId ?? '') === USER_ID.toHexString(), 'legacy assignedUserId mismatch');
  assert(card.cardLabel === CARD_LABEL, `legacy card label mismatch: ${card.cardLabel}`);
  assert(card.routeSlug === ROUTE_SLUG, `legacy routeSlug mismatch: ${card.routeSlug}`);
  assert(card.urlAlias === URL_ALIAS, `legacy urlAlias mismatch: ${card.urlAlias}`);
  assert(card.cardUid === CARD_UID, `legacy cardUid mismatch: ${card.cardUid}`);
  assert((card.publicSlug ?? null) === null, `legacy publicSlug expected null, got ${card.publicSlug}`);
  assert(card.kind === 'profile', `legacy card kind mismatch: ${card.kind}`);

  const assignment = await db.collection('userproducts').findOne({ _id: ASSIGNMENT_ID });
  assert(assignment, 'legacy assignment not found');
  assert(String(assignment.userId) === USER_ID.toHexString(), 'assignment user mismatch');
  assert(String(assignment.catalogProductId) === PRODUCT_ID.toHexString(), 'assignment product mismatch');
  assert(String(assignment.cardId) === CARD_ID.toHexString(), 'assignment card mismatch');
  assert(assignment.status === 'active', `assignment status mismatch: ${assignment.status}`);

  const product = await db.collection('catalogproducts').findOne({ _id: PRODUCT_ID });
  assert(product, 'legacy catalog product not found');
  assert(product.slug === PRODUCT_SLUG, `legacy product slug mismatch: ${product.slug}`);
  assert(product.name === PRODUCT_NAME, `legacy product name mismatch: ${product.name}`);
  assert((product.kind ?? null) === null, `legacy product kind mismatch: ${product.kind}`);

  const otherAssignmentsForProduct = await db.collection('userproducts').countDocuments({
    catalogProductId: PRODUCT_ID,
    _id: { $ne: ASSIGNMENT_ID },
  });
  assert(otherAssignmentsForProduct === 0, `${otherAssignmentsForProduct} other assignment(s) reference the legacy product`);

  const otherAssignmentsForCard = await db.collection('userproducts').countDocuments({
    cardId: CARD_ID,
    _id: { $ne: ASSIGNMENT_ID },
  });
  assert(otherAssignmentsForCard === 0, `${otherAssignmentsForCard} other assignment(s) reference the legacy card`);

  return { card, assignment, product, user };
}

function assertOnlyExpectedHits(hits: ReferenceHit[]): void {
  const unexpected = hits.filter((hit) => !isTargetDocument(hit));
  if (unexpected.length) {
    fail(`unexpected references to the removal targets: ${JSON.stringify(unexpected, null, 2)}`);
  }
}

async function migrate(db: Db, args: Args): Promise<void> {
  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);

  const protectedBefore = await assertProtected(db);

  const existingCard = await db.collection('cards').findOne({ _id: CARD_ID });
  const existingAssignment = await db.collection('userproducts').findOne({ _id: ASSIGNMENT_ID });
  const existingProduct = await db.collection('catalogproducts').findOne({ _id: PRODUCT_ID });

  if (!existingCard && !existingAssignment && !existingProduct) {
    const remaining = await scanReferences(db);
    assert(remaining.length === 0, `targets are absent but references remain: ${JSON.stringify(remaining)}`);
    console.log('Already applied: card, assignment and product are absent. No changes made.');
    return;
  }

  const { card, assignment, product } = await assertTargets(db);

  const hitsBefore = await scanReferences(db);
  assertOnlyExpectedHits(hitsBefore);
  const unexpectedStrings = hitsBefore.filter(
    (hit) => isTargetDocument(hit) && hit.paths.some((p) => p.needle === PRODUCT_NAME)
  );
  if (unexpectedStrings.length) {
    console.log('Display-only name hits inside target documents:');
    for (const hit of unexpectedStrings) {
      console.log(`  ${hit.collection}/${mask(hit.documentId)} ${hit.paths.map((p) => p.path).join(', ')}`);
    }
  }

  console.log('Exact records verified:');
  console.log(`  card       ${card._id.toHexString()} label=${card.cardLabel} route=${card.routeSlug} alias=${card.urlAlias}`);
  console.log(`  assignment ${assignment._id.toHexString()} product=${assignment.catalogProductId} card=${assignment.cardId}`);
  console.log(`  product    ${product._id.toHexString()} slug=${product.slug} kind=null`);

  if (args.backupDir) {
    fs.mkdirSync(args.backupDir, { recursive: true });
    fs.writeFileSync(path.join(args.backupDir, 'target-card.json'), JSON.stringify(card, null, 2));
    fs.writeFileSync(path.join(args.backupDir, 'target-assignment.json'), JSON.stringify(assignment, null, 2));
    fs.writeFileSync(path.join(args.backupDir, 'target-product.json'), JSON.stringify(product, null, 2));
    console.log(`Backup written to ${args.backupDir}`);
  }

  if (!args.apply) {
    console.log('\nDry run complete. No writes performed. Re-run with --apply to remove.');
    return;
  }

  const assignmentDeletion = await db.collection('userproducts').deleteOne({
    _id: ASSIGNMENT_ID,
    userId: USER_ID,
    catalogProductId: PRODUCT_ID,
    cardId: CARD_ID,
  });
  assert(assignmentDeletion.deletedCount === 1, `expected 1 assignment deletion, got ${assignmentDeletion.deletedCount}`);
  console.log('Deleted legacy assignment: 1 document');

  const cardDeletion = await db.collection('cards').deleteOne({
    _id: CARD_ID,
    userId: USER_ID,
    cardUid: CARD_UID,
    routeSlug: ROUTE_SLUG,
    urlAlias: URL_ALIAS,
  });
  assert(cardDeletion.deletedCount === 1, `expected 1 card deletion, got ${cardDeletion.deletedCount}`);
  console.log('Deleted legacy card: 1 document');

  const productDeletion = await db.collection('catalogproducts').deleteOne({
    _id: PRODUCT_ID,
    slug: PRODUCT_SLUG,
    name: PRODUCT_NAME,
  });
  assert(productDeletion.deletedCount === 1, `expected 1 product deletion, got ${productDeletion.deletedCount}`);
  console.log('Deleted legacy catalog product: 1 document');

  const remaining = await scanReferences(db);
  assert(remaining.length === 0, `references remain after deletion: ${JSON.stringify(remaining)}`);

  const protectedAfter = await assertProtected(db);
  assert(
    JSON.stringify(protectedAfter.canonicalCard) === JSON.stringify(protectedBefore.canonicalCard),
    'canonical card changed during removal'
  );
  assert(
    JSON.stringify(protectedAfter.canonicalProduct) === JSON.stringify(protectedBefore.canonicalProduct),
    'canonical product changed during removal'
  );

  const userAssignments = await db.collection('userproducts').find({ userId: USER_ID, status: 'active' }).toArray();
  const canonicalAssignment = userAssignments.find(
    (row) => String(row.catalogProductId) === CANONICAL_PRODUCT_ID.toHexString()
  );
  assert(canonicalAssignment, 'canonical assignment missing after removal');
  assert(
    String(canonicalAssignment.cardId) === CANONICAL_CARD_ID.toHexString(),
    'canonical assignment card mismatch after removal'
  );
  assert(
    !userAssignments.some((row) => String(row.catalogProductId) === PRODUCT_ID.toHexString()),
    'legacy product assignment still present'
  );

  console.log('\nRemoval applied successfully. Canonical card/product untouched.');
}

async function rollback(db: Db, backupDir: string, apply: boolean): Promise<void> {
  const { card, assignment, product } = readBackup(backupDir);

  assert(String(product._id) === PRODUCT_ID.toHexString(), 'backup product _id mismatch');
  assert(product.slug === PRODUCT_SLUG && product.name === PRODUCT_NAME, 'backup product identity mismatch');
  assert(String(card._id) === CARD_ID.toHexString(), 'backup card _id mismatch');
  assert(card.cardLabel === CARD_LABEL && card.routeSlug === ROUTE_SLUG, 'backup card identity mismatch');
  assert(String(assignment._id) === ASSIGNMENT_ID.toHexString(), 'backup assignment _id mismatch');
  assert(String(assignment.cardId) === CARD_ID.toHexString(), 'backup assignment card mismatch');
  assert(String(assignment.catalogProductId) === PRODUCT_ID.toHexString(), 'backup assignment product mismatch');

  console.log(`\nDatabase: ${db.databaseName}`);
  console.log(`Mode: ${apply ? 'APPLY ROLLBACK' : 'DRY RUN ROLLBACK'}`);
  console.log(`Backup: ${backupDir}`);

  await assertProtected(db);

  const restoreCard = hydrate(card) as Document;
  const restoreAssignment = hydrate(assignment) as Document;
  const restoreProduct = hydrate(product) as Document;

  const existingCard = await db.collection('cards').findOne({ _id: CARD_ID });
  const existingAssignment = await db.collection('userproducts').findOne({ _id: ASSIGNMENT_ID });
  const existingProduct = await db.collection('catalogproducts').findOne({ _id: PRODUCT_ID });

  for (const [label, existing] of [
    ['card', existingCard],
    ['assignment', existingAssignment],
    ['product', existingProduct],
  ] as const) {
    if (existing) {
      console.log(`${label} already present; will not overwrite unless it matches the backup.`);
    }
  }

  if (!apply) {
    console.log('Dry run complete. No writes performed. Re-run with --apply to roll back.');
    return;
  }

  if (!existingProduct) {
    await db.collection('catalogproducts').insertOne(restoreProduct);
    console.log('Restored legacy catalog product.');
  }
  if (!existingCard) {
    await db.collection('cards').insertOne(restoreCard);
    console.log('Restored legacy card.');
  }
  if (!existingAssignment) {
    await db.collection('userproducts').insertOne(restoreAssignment);
    console.log('Restored legacy assignment.');
  }

  const restoredCard = await db.collection('cards').findOne({ _id: CARD_ID });
  const restoredAssignment = await db.collection('userproducts').findOne({ _id: ASSIGNMENT_ID });
  const restoredProduct = await db.collection('catalogproducts').findOne({ _id: PRODUCT_ID });
  assert(restoredCard && restoredAssignment && restoredProduct, 'restored documents missing');

  assert(JSON.stringify(restoredCard) === JSON.stringify(restoreCard), 'restored card does not match backup');
  assert(
    JSON.stringify(restoredAssignment) === JSON.stringify(restoreAssignment),
    'restored assignment does not match backup'
  );
  assert(
    JSON.stringify(restoredProduct) === JSON.stringify(restoreProduct),
    'restored product does not match backup'
  );

  console.log('\nRollback applied successfully. Canonical card/product untouched.');
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
