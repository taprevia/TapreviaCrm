/**
 * cleanup-smoke.ts — removes test fixture/smoke data created by the dynamic
 * routing smoke tests so the DB stays clean in staging/dev.
 *
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/cleanup-smoke.ts --yes
 *
 * WARNING: existing behavior also deletes ALL AnalyticsLog rows. The script
 * refuses to run unless the target is local and write confirmation is given.
 */
import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import UserProduct from '../src/models/UserProduct';
import Standee from '../src/models/Standee';
import AnalyticsLog from '../src/models/AnalyticsLog';
import {
  assertScriptWriteGuard,
  formatTargetSummary,
  hasFlag,
  parseMongoTarget,
} from '../src/lib/ops-script-safety';

const SCRIPT_ARGS = process.argv.slice(2);
let SCRIPT_TARGET: ReturnType<typeof parseMongoTarget>;
try {
  SCRIPT_TARGET = parseMongoTarget(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm',
    process.env.MONGODB_DB
  );
  assertScriptWriteGuard(SCRIPT_TARGET, {
    allowRemote: hasFlag(SCRIPT_ARGS, '--allow-remote') || process.env.ALLOW_REMOTE_DB_SCRIPT === 'true',
    remoteConfirmed: hasFlag(SCRIPT_ARGS, '--confirm-remote') || process.env.CONFIRM_REMOTE_DB === SCRIPT_TARGET.dbName,
    writeConfirmed: hasFlag(SCRIPT_ARGS, '--yes') || process.env.CONFIRM_DB_WRITE === SCRIPT_TARGET.dbName,
  });
} catch (error) {
  console.error(`[cleanup-smoke] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log(
  `[cleanup-smoke] ${formatTargetSummary(SCRIPT_TARGET)} action=delete smoke fixtures; ` +
    'WARNING: this script also deletes ALL AnalyticsLog rows (existing behavior).'
);

async function run() {
  await mongoose.connect(SCRIPT_TARGET.uri);
  const smokeUsers = await User.find({ email: /^smoke\./ }).select('_id');
  const ids = smokeUsers.map((u) => u._id);
  const ups = await UserProduct.find({ userId: { $in: ids } });
  for (const up of ups) {
    if (up.cardId) await Card.deleteOne({ _id: up.cardId });
    if (up.standeeId) await Standee.deleteOne({ _id: up.standeeId });
    await UserProduct.deleteOne({ _id: up._id });
  }
  const cardDel = await Card.deleteMany({ cardUid: /^(SMOKE-|SDYNA|SDYNB|M[0-9])/ });
  await AnalyticsLog.deleteMany({});
  await User.deleteMany({ _id: { $in: ids } });
  console.log(`cleaned ${ups.length} smoke UserProducts, ${cardDel.deletedCount} fixture cards`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
