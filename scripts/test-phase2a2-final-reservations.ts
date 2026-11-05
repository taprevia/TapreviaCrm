/**
 * E11 — Phase 2A-1 reservation readiness and non-reuse.
 *
 * Imports the existing production reservation service against the dedicated
 * test database only. No application code is modified. The marker and synthetic
 * records are restored before exit; the database is never dropped.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  PUBLIC_URL_RESERVATION_READY_KEY,
  PublicUrlReservationConflictError,
  PublicUrlReservationNotReadyError,
  allocateStandeePublicSlug,
  isPublicPathReserved,
  isPublicUrlReservationReady,
  reconcileStandeePublicSlug,
} from '@/lib/services/public-url-reservation';
import Standee from '@/models/Standee';
import Counter from '@/models/Counter';
import PublicUrlReservation from '@/models/PublicUrlReservation';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const results: Array<{ id: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];

function validate(): void {
  if (URI !== 'mongodb://127.0.0.1:27032') throw new Error('BLOCKED — wrong test URI');
  if (!/^taprevia_phase2a2_final_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== 'http://127.0.0.1:3201') throw new Error('BLOCKED — wrong base URL');
}

async function test(id: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ id, status: 'PASS' });
    console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, status: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${id} — ${results[results.length - 1].detail}`);
  }
}

async function main() {
  validate();
  await mongoose.connect(URI, { dbName: DB, serverSelectionTimeoutMS: 3000 });
  const conn = mongoose.connection;
  assert.equal(conn.host, '127.0.0.1', 'connection host is not loopback');
  assert.equal(conn.port, 27032, 'connection port mismatch');
  assert.equal(conn.name, DB, 'connection database mismatch');
  const raw = conn.db!;
  const reservations = raw.collection('public_url_reservations');

  await test('E11 readiness marker and unique path index are present', async () => {
    assert.equal(await isPublicUrlReservationReady(), true);
    assert.equal(await isPublicPathReserved('acme/standee'), true);
    const indexes = await PublicUrlReservation.collection.indexes();
    assert.ok(indexes.some((i: any) => i.unique === true && i.key?.path === 1));
  });

  await test('E11 branded page visits write no new reservations', async () => {
    const before = await reservations.countDocuments({});
    for (const path of ['/acme/standee', '/acme/standee-4', '/acme/standee-9', '/reviewpub/standee']) {
      const res = await fetch(`${BASE}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      await res.text();
      assert.ok(res.status >= 200 && res.status < 400, `${path} status ${res.status}`);
    }
    assert.equal(await reservations.countDocuments({}), before);
  });

  await test('E11 existing publicSlug resolves and cannot be reconciled to another identity', async () => {
    const acme: any = await Standee.findOne({ publicSlug: 'acme/standee' }).lean();
    assert.ok(acme);
    const other: any = await Standee.findOne({ publicSlug: 'e11alloc/standee-2' }).lean().catch(() => null);
    await assert.rejects(
      reconcileStandeePublicSlug({
        standeeId: other?._id ?? new ObjectId(),
        ownerId: acme!.userId,
        publicSlug: 'acme/standee',
      }),
      (error: unknown) => error instanceof PublicUrlReservationConflictError
    );
  });

  const allocationTarget = await raw.collection('standees').findOne({ routeSlug: 'r_e11alloc' });
  assert.ok(allocationTarget, 'E11 allocation target missing');

  await test('E11 retired URL is never reused by the allocation path', async () => {
    await Counter.updateOne(
      { _id: 'standee-slug:e11alloc' },
      { $set: { seq: 0 } },
      { upsert: true }
    );
    assert.equal(await isPublicPathReserved('e11alloc/standee'), true);
    const allocated = await allocateStandeePublicSlug({
      standeeId: allocationTarget!._id,
      ownerId: allocationTarget!.userId,
      bizSlug: 'e11alloc',
    });
    assert.equal(allocated, 'e11alloc/standee-2');
    assert.notEqual(allocated, 'e11alloc/standee');
    assert.equal(await isPublicPathReserved('e11alloc/standee'), true);
    const stored = await Standee.findById(allocationTarget!._id).lean();
    assert.equal((stored as any)?.publicSlug, 'e11alloc/standee-2');
  });

  await test('E11 missing readiness marker blocks allocation but not existing URL reads', async () => {
    const marker: any = await Counter.findById(PUBLIC_URL_RESERVATION_READY_KEY).lean();
    assert.ok(marker, 'readiness marker missing before test');
    const freshId = new ObjectId();
    await raw.collection('standees').insertOne({
      _id: freshId,
      userId: allocationTarget!.userId,
      name: 'E11 Blocked Allocation',
      displayName: 'E11 Blocked Allocation',
      routeSlug: 'r_e11blocked',
      uid: 'u_e11blocked',
      productKey: 'BUSINESS_PROFILE_STANDEE',
      maxProfiles: 1,
      fixedProfiles: ['whatsapp'],
      panelQr: { qrId: 'panel_e11blocked', qrColor: '#000000' },
      socialQrs: [{ platform: 'whatsapp', qrId: 'soc_e11blocked', destinationUrl: 'https://example.test/e11-blocked', qrColor: '#000000', label: 'whatsapp' }],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      await Counter.deleteOne({ _id: PUBLIC_URL_RESERVATION_READY_KEY });
      assert.equal(await isPublicUrlReservationReady(), false);
      await assert.rejects(
        allocateStandeePublicSlug({
          standeeId: freshId,
          ownerId: allocationTarget!.userId,
          bizSlug: 'e11blocked',
        }),
        (error: unknown) => error instanceof PublicUrlReservationNotReadyError
      );
      const existing = await fetch(`${BASE}/acme/standee`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      await existing.text();
      assert.equal(existing.status, 307);
      assert.equal(existing.headers.get('location'), '/r/r_single');
    } finally {
      await Counter.updateOne(
        { _id: PUBLIC_URL_RESERVATION_READY_KEY },
        { $set: { seq: marker!.seq ?? 1 } },
        { upsert: true }
      );
      await raw.collection('standees').deleteOne({ _id: freshId });
    }
    assert.equal(await isPublicUrlReservationReady(), true);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ database: DB, passed: results.length - failures.length, failed: failures.length, results }, null, 2));
  await mongoose.disconnect();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`E11 BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
