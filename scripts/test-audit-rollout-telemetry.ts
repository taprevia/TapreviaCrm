/**
 * Focused test: denied standee rollout emits review.rollout.denied, not allowed.
 * Isolated synthetic DB only.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { resolveStandeeReviewHost } from '@/lib/services/review-standee-settings';
import { assertIsolatedTarget, seedPhaseb1 } from './phaseb1-fixtures';

assertIsolatedTarget();
const captured: string[] = [];
const orig = { info: console.info, warn: console.warn, error: console.error };
console.info = (...a: unknown[]) => captured.push(a.map(String).join(' '));
console.warn = (...a: unknown[]) => captured.push(a.map(String).join(' '));
console.error = (...a: unknown[]) => captured.push(a.map(String).join(' '));

(async () => {
  await seedPhaseb1();
  const db = mongoose.connection.db!;
  await db.collection('standees').updateOne({ routeSlug: 'b1-standee' }, { $set: { reviewSettingsSource: 'central' } });
  await resolveStandeeReviewHost('b1-standee');
  const lines = captured.filter((l) => l.includes('review.rollout'));
  console.info = orig.info; console.warn = orig.warn; console.error = orig.error;
  const denied = lines.some((l) => l.includes('review.rollout.denied') && l.includes('tenant_not_allowlisted'));
  const allowed = lines.some((l) => l.includes('review.rollout.allowed'));
  const leakedTenant = lines.some((l) => l.includes('0000000000000000000b1001'));
  console.log(JSON.stringify({ denied, allowed, leakedTenant, eventLines: lines }, null, 2));
  assert.equal(denied, true, 'denied event missing');
  assert.equal(allowed, false, 'allowed event emitted for denied rollout');
  assert.equal(leakedTenant, false, 'raw tenant ID leaked');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log('PASS denied rollout telemetry');
})().catch(async (e) => {
  console.info = orig.info; console.warn = orig.warn; console.error = orig.error;
  console.error(e);
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
