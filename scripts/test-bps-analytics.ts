/**
 * Business Profile Standee analytics double-count regression tests.
 *
 * Disposable-DB integration test: connects to a throwaway database, exercises
 * the one-time standee visit-attribution marker and `recordPublicVisit`, and
 * drops the database. It never touches real local data.
 *
 * Verifies one physical BPS QR scan produces exactly one visit, attributed to
 * the Standee, while a direct Card visit is unchanged.
 *
 * Run:
 *   MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB=taprevia_bps_analytics_test \
 *   npx tsx scripts/test-bps-analytics.ts
 */

import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import AnalyticsLog from '@/models/AnalyticsLog';
import PublicVisitMarker from '@/models/PublicVisitMarker';
import {
  mintStandeeVisitMarker,
  consumeStandeeVisitMarker,
  recordPublicVisit,
} from '@/lib/services/public-visits';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const STANDEE_ID = new mongoose.Types.ObjectId();
const CARD_ID = new mongoose.Types.ObjectId();
const FOREIGN_CARD = new mongoose.Types.ObjectId();

/** Header mock that is treated as a real human GET navigation. */
const headers = { get: () => null } as { get(name: string): string | null };

async function main(): Promise<void> {
  await connectDB();
  await mongoose.connection.dropDatabase().catch(() => undefined);

  console.log('\n── 1. Standee visit-attribution marker (single-use) ──');
  const token = await mintStandeeVisitMarker(STANDEE_ID, CARD_ID);
  check('mint returns an opaque token', typeof token === 'string' && token.length > 0);

  const first = await consumeStandeeVisitMarker(token, CARD_ID);
  check('consume returns standee attribution', !!first && String(first.standeeId) === String(STANDEE_ID));

  const second = await consumeStandeeVisitMarker(token, CARD_ID);
  check('marker is single-use (second consume → null)', second === null);

  const foreign = await mintStandeeVisitMarker(STANDEE_ID, CARD_ID);
  const foreignConsume = await consumeStandeeVisitMarker(foreign, FOREIGN_CARD);
  check('foreign cardId rejected (null)', foreignConsume === null);
  // The foreign-bound token must still be consumable by its OWN card (not leaked).
  const ownConsume = await consumeStandeeVisitMarker(foreign, CARD_ID);
  check('token still valid for its own card', !!ownConsume && String(ownConsume.standeeId) === String(STANDEE_ID));

  const expiredToken = await mintStandeeVisitMarker(STANDEE_ID, CARD_ID);
  await PublicVisitMarker.updateOne(
    { token: expiredToken },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  );
  const expired = await consumeStandeeVisitMarker(expiredToken, CARD_ID);
  check('expired marker rejected (null)', expired === null);

  const none = await consumeStandeeVisitMarker(undefined, CARD_ID);
  check('missing token → null', none === null);

  console.log('\n── 2. recordPublicVisit (one event per call) ──');
  await AnalyticsLog.deleteMany({});
  await recordPublicVisit({ cardId: CARD_ID, standeeId: STANDEE_ID, headers, method: 'GET' });
  const rows = await AnalyticsLog.find({ action: 'public_visit' }).lean();
  check('one standee-attributed visit written', rows.length === 1);
  check('row carries cardId', !!rows[0] && String(rows[0].cardId) === String(CARD_ID));
  check('row carries standeeId', !!rows[0] && String(rows[0].standeeId) === String(STANDEE_ID));

  console.log('\n── 3. Direct Card visit (no standee attribution) ──');
  await AnalyticsLog.deleteMany({});
  await recordPublicVisit({ cardId: CARD_ID, headers, method: 'GET' });
  const cardRows = await AnalyticsLog.find({ action: 'public_visit' }).lean();
  check('one card visit written', cardRows.length === 1);
  check('card row has no standeeId', !!cardRows[0] && !cardRows[0].standeeId);

  console.log('\n── Cleanup (drop disposable DB) ──');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`PASSED ${passed}  FAILED ${failed}`);
  if (failures.length) {
    console.log('Failed checks:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
