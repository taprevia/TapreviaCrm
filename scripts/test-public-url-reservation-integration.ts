/**
 * Phase 2A-1 isolated integration tests.
 *
 * SAFETY: refuses to run unless a dedicated loopback-only mongod is proven by
 * PID, port ownership, and test-owned storage. It never uses connectDB() or
 * MONGODB_URI from application configuration.
 *
 * It creates only new test-owned databases. It never drops them and never
 * touches existing local databases.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const URI = process.env.PHASE2A1_TEST_URI ?? '';
const DB = process.env.PHASE2A1_TEST_DB ?? '';
const DB_BACKFILL = `${DB}_backfill`;
const DB_CONFLICT = `${DB}_conflict`;
const PID = process.env.PHASE2A1_TEST_PID ?? '';
const STORAGE = path.resolve(process.env.PHASE2A1_TEST_STORAGE ?? '');
const PORT = 27029;

type Status = 'PASS' | 'FAIL';
interface Result {
  id: string;
  name: string;
  status: Status;
  detail?: string;
}

const results: Result[] = [];

async function test(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ id, name, status: 'PASS' });
    console.log(`PASS ${id} ${name}`);
  } catch (error) {
    results.push({
      id,
      name,
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error),
    });
    console.log(`FAIL ${id} ${name} — ${results[results.length - 1].detail}`);
  }
}

function validateIsolation(): void {
  if (!URI || URI !== `mongodb://127.0.0.1:${PORT}`) {
    throw new Error('BLOCKED — test URI must be exactly the dedicated loopback test instance');
  }
  if (/mongodb\+srv|\.mongodb\.net|cluster0|atlas|@/i.test(URI)) {
    throw new Error('BLOCKED — forbidden remote MongoDB URI pattern');
  }
  if (!/^taprevia_phase2a1_isolated_[a-z0-9_]+$/.test(DB)) {
    throw new Error('BLOCKED — test database name is not a new isolated test-owned name');
  }
  if (!/^\d+$/.test(PID)) {
    throw new Error('BLOCKED — test PID is missing');
  }
  if (!STORAGE.includes(`${path.sep}opencode${path.sep}phase2a1.`)) {
    throw new Error('BLOCKED — storage is not under the test-owned opencode temp path');
  }

  const command = execFileSync('ps', ['-p', PID, '-o', 'command='], {
    encoding: 'utf8',
  }).trim();
  const expectedDbPath = `--dbpath ${STORAGE}/db`;
  if (
    !command.includes('mongod') ||
    !command.includes(expectedDbPath) ||
    !command.includes(`--port ${PORT}`) ||
    !command.includes('--bind_ip 127.0.0.1') ||
    !command.includes('--nounixsocket')
  ) {
    throw new Error('BLOCKED — PID is not the dedicated test-owned loopback mongod');
  }

  const lsof = execFileSync(
    'lsof',
    ['-nP', `-iTCP:${PORT}`, '-sTCP:LISTEN'],
    { encoding: 'utf8' }
  );
  if (!lsof.includes(PID)) {
    throw new Error('BLOCKED — port is not owned by the recorded test PID');
  }

  if (process.env.MONGODB_URI && process.env.MONGODB_URI !== URI) {
    throw new Error('BLOCKED — inherited MONGODB_URI differs from the test instance');
  }
  if (process.env.MONGODB_DB && process.env.MONGODB_DB !== DB) {
    throw new Error('BLOCKED — inherited MONGODB_DB differs from the test database');
  }
}

async function assertDatabaseAbsent(name: string): Promise<void> {
  const client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  try {
    const names = (await client.db().admin().listDatabases()).databases.map(
      (entry) => entry.name
    );
    if (names.includes(name)) {
      throw new Error(`BLOCKED — test database already existed: ${name}`);
    }
  } finally {
    await client.close();
  }
}

function token(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  validateIsolation();
  await assertDatabaseAbsent(DB);
  await assertDatabaseAbsent(DB_BACKFILL);
  await assertDatabaseAbsent(DB_CONFLICT);

  const mongoose = (await import('mongoose')).default;
  await mongoose.connect(URI, {
    dbName: DB,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  assert.equal(mongoose.connection.name, DB);

  const Standee: any = (await import('@/models/Standee')).default;
  const User: any = (await import('@/models/User')).default;
  const Card: any = (await import('@/models/Card')).default;
  const Counter: any = (await import('@/models/Counter')).default;
  const PublicUrlReservation: any = (await import('@/models/PublicUrlReservation')).default;
  const reservationService: typeof import('@/lib/services/public-url-reservation') =
    await import('@/lib/services/public-url-reservation');
  const { ensureStandeePublicSlug } = await import('@/lib/services/human-url');
  const { deleteStandeeCascade } = await import('@/lib/services/standee-deletion');

  const makeUser = async (bizSlug: string): Promise<any> => {
    const _id = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id,
      name: 'Phase 2A1 Test',
      email: `${token('u')}@test.local`,
      passwordHash: 'x',
      role: 'customer',
      status: 'active',
      bizSlug,
      hasStandy: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return _id;
  };

  const makeStandee = async (
    userId: any,
    overrides: Record<string, unknown> = {}
  ): Promise<any> => {
    const key = token('s');
    return Standee.create({
      userId,
      name: 'Phase 2A1 Standee',
      displayName: 'Phase 2A1 Standee',
      routeSlug: `p2a1r${key}`,
      uid: `p2a1r${key}`,
      productKey: 'BUSINESS_PROFILE_STANDEE',
      maxProfiles: 1,
      fixedProfiles: ['whatsapp'],
      panelQr: { qrId: `P2A1P${key}`, qrColor: '#000000' },
      socialQrs: [
        {
          qrId: `P2A1S${key}`,
          platform: 'whatsapp',
          qrColor: '#000000',
          label: 'WhatsApp',
          destinationUrl: '',
        },
      ],
      ...overrides,
    });
  };

  const ensure = async (standee: any, userId: any): Promise<string> => {
    const result = await ensureStandeePublicSlug(standee._id, userId);
    assert.equal(result.assigned, true);
    assert.ok(result.publicSlug);
    return result.publicSlug as string;
  };

  // T17 — missing unique index blocks allocation.
  await test('T17', 'missing unique index blocks allocation', async () => {
    const user = await makeUser(`p2a1idx${token('b')}`);
    const standee = await makeStandee(user);
    await assert.rejects(
      () => ensure(standee, user),
      (error: any) => error?.code === 'PUBLIC_URL_RESERVATION_NOT_READY'
    );
    const fresh = await Standee.findById(standee._id).lean();
    assert.equal(fresh?.publicSlug, undefined);
    assert.equal(
      await PublicUrlReservation.countDocuments({ instanceId: standee._id }),
      0
    );
  });

  await PublicUrlReservation.collection.createIndex(
    { path: 1 },
    { unique: true, name: 'path_1' }
  );

  // T19 — index present but readiness marker absent.
  await test('T19', 'missing readiness marker blocks allocation', async () => {
    const user = await makeUser(`p2a1marker${token('b')}`);
    const standee = await makeStandee(user);
    await assert.rejects(
      () => ensure(standee, user),
      (error: any) => error?.code === 'PUBLIC_URL_RESERVATION_NOT_READY'
    );
    const fresh = await Standee.findById(standee._id).lean();
    assert.equal(fresh?.publicSlug, undefined);
  });

  await Counter.updateOne(
    { _id: reservationService.PUBLIC_URL_RESERVATION_READY_KEY },
    { $set: { seq: 1 } },
    { upsert: true }
  );

  // T18 — index + marker readiness.
  await test('T18', 'unique index and readiness marker enable allocation', async () => {
    assert.equal(await reservationService.isPublicUrlReservationReady(), true);
  });

  // T1/T2 — first and second allocation.
  await test('T1/T2', 'first and second Standees receive standee and standee-2', async () => {
    const biz = `p2a1first${token('b')}`;
    const user = await makeUser(biz);
    const first = await makeStandee(user);
    const second = await makeStandee(user);
    const firstSlug = await ensure(first, user);
    const secondSlug = await ensure(second, user);
    assert.equal(firstSlug, `${biz}/standee`);
    assert.equal(secondSlug, `${biz}/standee-2`);

    const firstReservation = await PublicUrlReservation.findOne({
      path: firstSlug,
    }).lean();
    assert.equal(firstReservation?.kind, 'standee');
    assert.equal(String(firstReservation?.instanceId), String(first._id));
    assert.equal(firstReservation?.status, 'active');
    assert.notEqual(String(firstReservation?.instanceId), String(second._id));
  });

  // T3-T6 — deletion and recreation.
  await test('T3-T6', 'deleted suffixes are never reused after delete/recreate cycles', async () => {
    const biz = `p2a1delete${token('b')}`;
    const user = await makeUser(biz);
    const a = await makeStandee(user);
    const b = await makeStandee(user);
    const aSlug = await ensure(a, user);
    const bSlug = await ensure(b, user);
    assert.equal(aSlug, `${biz}/standee`);
    assert.equal(bSlug, `${biz}/standee-2`);

    assert.equal((await deleteStandeeCascade(a._id)).ok, true);
    const aReservation = await PublicUrlReservation.findOne({ path: aSlug }).lean();
    assert.equal(aReservation?.status, 'retired');
    assert.equal(await Standee.exists({ publicSlug: aSlug }), null);

    const c = await makeStandee(user);
    const cSlug = await ensure(c, user);
    assert.equal(cSlug, `${biz}/standee-3`);
    assert.notEqual(cSlug, aSlug);

    assert.equal((await deleteStandeeCascade(c._id)).ok, true);
    const d = await makeStandee(user);
    const dSlug = await ensure(d, user);
    assert.equal(dSlug, `${biz}/standee-4`);

    for (const s of [b, d]) {
      await deleteStandeeCascade(s._id);
    }
    const e = await makeStandee(user);
    const eSlug = await ensure(e, user);
    assert.equal(eSlug, `${biz}/standee-5`);

    const paths = await PublicUrlReservation.find({
      path: { $regex: `^${biz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/` },
    })
      .select('path status')
      .lean();
    assert.equal(paths.length, 5);
    assert.equal(new Set(paths.map((row: any) => row.path)).size, 5);
  });

  // T7 — different Standees concurrent allocation.
  await test('T7', 'concurrent different-Standee allocation is unique', async () => {
    const biz = `p2a1conc${token('b')}`;
    const user = await makeUser(biz);
    const standees = await Promise.all(
      Array.from({ length: 8 }, () => makeStandee(user))
    );
    const slugs = await Promise.all(standees.map((s: any) => ensure(s, user)));
    assert.equal(new Set(slugs).size, slugs.length);
    for (const slug of slugs) {
      assert.match(slug, new RegExp(`^${biz}/standee(?:-[1-9][0-9]*)?$`));
      const reservation = await PublicUrlReservation.findOne({ path: slug }).lean();
      assert.equal(reservation?.kind, 'standee');
    }
  });

  // T8 — same Standee concurrency/idempotency.
  await test('T8', 'concurrent same-Standee allocation is idempotent', async () => {
    const biz = `p2a1same${token('b')}`;
    const user = await makeUser(biz);
    const standee = await makeStandee(user);
    const slugs = await Promise.all(
      Array.from({ length: 6 }, () => ensure(standee, user))
    );
    assert.equal(new Set(slugs).size, 1);
    const fresh = await Standee.findById(standee._id).lean();
    assert.equal(fresh?.publicSlug, slugs[0]);
    const reservations = await PublicUrlReservation.find({
      instanceId: standee._id,
    }).lean();
    assert.ok(reservations.length >= 1);
    assert.equal(
      new Set(reservations.map((row: any) => String(row.path))).size,
      reservations.length
    );
  });

  // T9 — controlled reservation insert failure.
  await test('T9', 'reservation insert failure assigns no publicSlug', async () => {
    const biz = `p2a1fail${token('b')}`;
    const user = await makeUser(biz);
    const standee = await makeStandee(user);
    const originalCreate = (PublicUrlReservation as any).create;
    (PublicUrlReservation as any).create = async () => {
      throw new Error('forced reservation insert failure');
    };
    try {
      await assert.rejects(() => ensure(standee, user), /forced reservation insert failure/);
    } finally {
      (PublicUrlReservation as any).create = originalCreate;
    }
    const fresh = await Standee.findById(standee._id).lean();
    assert.equal(fresh?.publicSlug, undefined);
    assert.equal(
      await PublicUrlReservation.countDocuments({ instanceId: standee._id }),
      0
    );
  });

  // T10 — failure after reservation insert, before Standee update.
  await test('T10', 'partial allocation leaves a permanently reserved orphan', async () => {
    const biz = `p2a1partial${token('b')}`;
    const user = await makeUser(biz);
    const standee = await makeStandee(user);
    const originalUpdate = (Standee as any).updateOne;
    (Standee as any).updateOne = async () => {
      throw new Error('forced standee update failure');
    };
    try {
      await assert.rejects(() => ensure(standee, user), /forced standee update failure/);
    } finally {
      (Standee as any).updateOne = originalUpdate;
    }
    const fresh = await Standee.findById(standee._id).lean();
    assert.equal(fresh?.publicSlug, undefined);
    const orphan = await PublicUrlReservation.findOne({
      instanceId: standee._id,
    }).lean();
    assert.ok(orphan);

    const assigned = await ensure(standee, user);
    assert.notEqual(assigned, orphan.path);
    const stillReserved = await PublicUrlReservation.findOne({
      path: orphan.path,
    }).lean();
    assert.ok(stillReserved);
  });

  // T11 — legacy existing publicSlug.
  await test('T11', 'existing publicSlug is preserved and reconciled', async () => {
    const biz = `p2a1legacy${token('b')}`;
    const user = await makeUser(biz);
    const pathValue = `${biz}/standee-77`;
    const standee = await makeStandee(user, { publicSlug: pathValue });
    const assigned = await ensure(standee, user);
    assert.equal(assigned, pathValue);
    const reservation = await PublicUrlReservation.findOne({ path: pathValue }).lean();
    assert.equal(String(reservation?.instanceId), String(standee._id));
    assert.equal(reservation?.status, 'active');
  });

  // T12 — reservation identity conflict.
  await test('T12', 'reservation conflict fails closed', async () => {
    const biz = `p2a1conflict${token('b')}`;
    const user = await makeUser(biz);
    const pathValue = `${biz}/standee-88`;
    const otherId = new mongoose.Types.ObjectId();
    await PublicUrlReservation.create({
      path: pathValue,
      kind: 'standee',
      instanceId: otherId,
      ownerId: user,
      status: 'active',
      source: 'backfill',
    });
    const standee = await makeStandee(user, { publicSlug: pathValue });
    await assert.rejects(
      () => ensure(standee, user),
      (error: any) => error?.code === 'PUBLIC_URL_RESERVATION_CONFLICT'
    );
    const reservation = await PublicUrlReservation.findOne({ path: pathValue }).lean();
    assert.equal(String(reservation?.instanceId), String(otherId));
  });

  // T13 — deletion failure must not delete the Standee.
  await test('T13', 'reservation conflict blocks Standee deletion', async () => {
    const biz = `p2a1delfail${token('b')}`;
    const user = await makeUser(biz);
    const pathValue = `${biz}/standee-99`;
    const otherId = new mongoose.Types.ObjectId();
    await PublicUrlReservation.create({
      path: pathValue,
      kind: 'standee',
      instanceId: otherId,
      ownerId: user,
      status: 'active',
      source: 'backfill',
    });
    const standee = await makeStandee(user, { publicSlug: pathValue });
    await assert.rejects(() => deleteStandeeCascade(standee._id));
    assert.ok(await Standee.exists({ _id: standee._id }));
    const reservation = await PublicUrlReservation.findOne({ path: pathValue }).lean();
    assert.equal(String(reservation?.instanceId), String(otherId));
  });

  // T14 — account reservation retirement service.
  await test('T14', 'account Standee reservations retire before deletion', async () => {
    const biz = `p2a1acct${token('b')}`;
    const user = await makeUser(biz);
    const a = await makeStandee(user);
    const b = await makeStandee(user);
    const aSlug = await ensure(a, user);
    const bSlug = await ensure(b, user);
    const retired = await reservationService.retireStandeeReservationsForUser(user);
    assert.equal(retired, 2);
    for (const slug of [aSlug, bSlug]) {
      const row = await PublicUrlReservation.findOne({ path: slug }).lean();
      assert.equal(row?.status, 'retired');
    }
    assert.ok(await Standee.exists({ _id: a._id }));
    assert.ok(await Standee.exists({ _id: b._id }));
  });

  // T15 — partial retirement failure aborts before destructive deletion.
  await test('T15', 'partial retirement conflict aborts account flow', async () => {
    const biz = `p2a1acctfail${token('b')}`;
    const user = await makeUser(biz);
    const a = await makeStandee(user);
    const b = await makeStandee(user);
    await ensure(a, user);
    const conflictPath = `${biz}/standee-88`;
    const otherId = new mongoose.Types.ObjectId();
    await PublicUrlReservation.create({
      path: conflictPath,
      kind: 'standee',
      instanceId: otherId,
      ownerId: user,
      status: 'active',
      source: 'backfill',
    });
    await Standee.updateOne({ _id: b._id }, { $set: { publicSlug: conflictPath } });
    await assert.rejects(() =>
      reservationService.retireStandeeReservationsForUser(user)
    );
    assert.ok(await Standee.exists({ _id: a._id }));
    assert.ok(await Standee.exists({ _id: b._id }));
  });

  // T16 — static deletion-order checks.
  await test('T16', 'deletion paths preserve reservations before destruction', async () => {
    const deletion = readFileSync('src/lib/services/standee-deletion.ts', 'utf8');
    const account = readFileSync('src/app/api/admin/users/[id]/route.ts', 'utf8');
    assert.ok(
      deletion.indexOf('retireStandeePublicSlugReservation') <
        deletion.indexOf('Standee.deleteOne')
    );
    assert.ok(
      account.indexOf('retireStandeeReservationsForUser') <
        account.indexOf('Standee.deleteMany')
    );
  });

  // T20 — dry-run backfill no writes.
  await test('T20', 'backfill dry run performs no writes', async () => {
    const before = await PublicUrlReservation.countDocuments();
    const output = execFileSync(
      path.join(process.cwd(), 'node_modules/.bin/tsx'),
      ['scripts/backfill-public-url-reservations.ts'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: URI,
          MONGODB_DB: DB,
          NODE_ENV: 'production',
        },
      }
    );
    assert.match(output, /"writeMode": false/);
    assert.match(output, /"indexReady": true/);
    assert.equal(await PublicUrlReservation.countDocuments(), before);
  });

  // Switch to a clean DB for write/backfill tests.
  await mongoose.disconnect();
  await mongoose.connect(URI, {
    dbName: DB_BACKFILL,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  assert.equal(mongoose.connection.name, DB_BACKFILL);
  await PublicUrlReservation.collection.createIndex(
    { path: 1 },
    { unique: true, name: 'path_1' }
  );

  const backfillBiz = `p2a1backfill${token('b')}`;
  const backfillUser = await makeUser(backfillBiz);
  const legacyA = await makeStandee(backfillUser, {
    publicSlug: `${backfillBiz}/standee`,
  });
  const legacyB = await makeStandee(backfillUser, {
    publicSlug: `${backfillBiz}/standee-3`,
  });
  await Card.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    cardUid: token('card'),
    slug: token('card-slug'),
    kind: 'profile',
    status: 'active',
    isActive: true,
    publicSlug: `${backfillBiz}/card-x`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await Counter.updateOne(
    { _id: `standee-slug:${backfillBiz}` },
    { $set: { seq: 0 } },
    { upsert: true }
  );

  // T21 — backfill write mode.
  await test('T21', 'backfill write reserves legacy paths and seeds counters', async () => {
    const output = execFileSync(
      path.join(process.cwd(), 'node_modules/.bin/tsx'),
      ['scripts/backfill-public-url-reservations.ts', '--write'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: URI,
          MONGODB_DB: DB_BACKFILL,
          NODE_ENV: 'production',
          PUBLIC_URL_RESERVATION_BACKFILL_WRITE: 'YES',
        },
      }
    );
    assert.match(output, /Activation completed/);
    for (const standee of [legacyA, legacyB]) {
      const reservation = await PublicUrlReservation.findOne({
        path: standee.publicSlug,
      }).lean();
      assert.equal(reservation?.kind, 'standee');
      assert.equal(String(reservation?.instanceId), String(standee._id));
      assert.equal(reservation?.status, 'active');
    }
    const counter = await Counter.findById(`standee-slug:${backfillBiz}`).lean();
    assert.equal(counter?.seq, 3);
    assert.equal(
      Boolean(
        await Counter.exists({
          _id: reservationService.PUBLIC_URL_RESERVATION_READY_KEY,
        })
      ),
      true
    );
    const freshA = await Standee.findById(legacyA._id).lean();
    const freshB = await Standee.findById(legacyB._id).lean();
    assert.equal(freshA?.publicSlug, `${backfillBiz}/standee`);
    assert.equal(freshB?.publicSlug, `${backfillBiz}/standee-3`);
  });

  // T25 — historical path import.
  await test('T25', 'historical paths are reserved as retired', async () => {
    const historicalPath = `${backfillBiz}/standee-9`;
    const historicalFile = path.join(STORAGE, `historical-${token('h')}.json`);
    writeFileSync(historicalFile, JSON.stringify([historicalPath]), 'utf8');
    execFileSync(
      path.join(process.cwd(), 'node_modules/.bin/tsx'),
      [
        'scripts/backfill-public-url-reservations.ts',
        '--write',
        `--historical=${historicalFile}`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: URI,
          MONGODB_DB: DB_BACKFILL,
          NODE_ENV: 'production',
          PUBLIC_URL_RESERVATION_BACKFILL_WRITE: 'YES',
        },
      }
    );
    const reservation = await PublicUrlReservation.findOne({
      path: historicalPath,
    }).lean();
    assert.equal(reservation?.kind, 'standee');
    assert.equal(reservation?.status, 'retired');
    assert.equal(reservation?.instanceId ?? null, null);
    const counter = await Counter.findById(`standee-slug:${backfillBiz}`).lean();
    assert.ok((counter?.seq ?? 0) >= 9);
  });

  // T24 — counter behind reserved history cannot cause reuse.
  await test('T24', 'counter behind existing suffixes cannot reuse paths', async () => {
    await Counter.updateOne(
      { _id: `standee-slug:${backfillBiz}` },
      { $set: { seq: 1 } },
      { upsert: true }
    );
    const standee = await makeStandee(backfillUser);
    const slug = await ensure(standee, backfillUser);
    assert.notEqual(slug, `${backfillBiz}/standee`);
    assert.notEqual(slug, `${backfillBiz}/standee-3`);
    assert.notEqual(slug, `${backfillBiz}/standee-9`);
    const reservation = await PublicUrlReservation.findOne({ path: slug }).lean();
    assert.equal(String(reservation?.instanceId), String(standee._id));
  });

  // T22/T23 — duplicate and Card/Standee conflicts block activation.
  await mongoose.disconnect();
  await mongoose.connect(URI, {
    dbName: DB_CONFLICT,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
  });
  assert.equal(mongoose.connection.name, DB_CONFLICT);
  await PublicUrlReservation.collection.createIndex(
    { path: 1 },
    { unique: true, name: 'path_1' }
  );
  const conflictBiz = `p2a1conflictbackfill${token('b')}`;
  const conflictUser = await makeUser(conflictBiz);
  await makeStandee(conflictUser, { publicSlug: `${conflictBiz}/standee` });
  await makeStandee(conflictUser, { publicSlug: `${conflictBiz}/standee` });
  await Card.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    cardUid: token('card'),
    slug: token('card-slug'),
    kind: 'profile',
    status: 'active',
    isActive: true,
    publicSlug: `${conflictBiz}/standee`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await test('T22/T23', 'backfill detects duplicate and Card/Standee conflicts', async () => {
    const before = await PublicUrlReservation.countDocuments();
    const output = execFileSync(
      path.join(process.cwd(), 'node_modules/.bin/tsx'),
      ['scripts/backfill-public-url-reservations.ts'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          MONGODB_URI: URI,
          MONGODB_DB: DB_CONFLICT,
          NODE_ENV: 'production',
        },
      }
    );
    assert.match(output, /"duplicatePaths": \[/);
    assert.match(output, /"conflicts": \[/);
    assert.equal(await PublicUrlReservation.countDocuments(), before);
  });

  // Backward compatibility static checks.
  await test('BC1', 'protected QR, analytics, landing, and auth files are unchanged', async () => {
    const changed = execFileSync('git', ['status', '--porcelain'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const forbidden = [
      'src/app/r/',
      'src/app/qr/',
      'src/app/api/analytics/',
      'src/app/api/my/qr',
      'src/app/api/public/',
      'src/app/[business]/',
      'src/app/panel/',
      'src/app/standee-review/',
      'src/app/review/',
      'src/app/profile/',
      'src/app/t/',
      'src/app/c/',
      'src/components/public/',
      'src/lib/qr-pdf.ts',
      'src/lib/admin-card-view.ts',
      'src/utils/qr-server.ts',
    ];
    for (const prefix of forbidden) {
      assert.equal(changed.includes(prefix), false, `protected path changed: ${prefix}`);
    }
  });

  await test('BC2', 'Phase 1 middleware remains present and unchanged in scope', async () => {
    const middleware = readFileSync('src/middleware.ts', 'utf8');
    assert.match(middleware, /isBrandedStandeePublicPath/);
    assert.match(middleware, /STANDEE_PUBLIC_PATH/);
    assert.match(middleware, /response\.cookies\.set\('token', '', \{ maxAge: 0, path: '\/' \}\)/);
  });

  const failures = results.filter((result) => result.status === 'FAIL');
  console.log(
    JSON.stringify(
      {
        database: DB,
        backfillDatabase: DB_BACKFILL,
        conflictDatabase: DB_CONFLICT,
        results,
        passed: results.length - failures.length,
        failed: failures.length,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(
    `INTEGRATION BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
