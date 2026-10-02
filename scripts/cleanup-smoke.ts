/**
 * cleanup-smoke.ts — removes test fixture/smoke data created by the dynamic
 * routing smoke tests so the DB stays clean in staging/dev.
 *
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/cleanup-smoke.ts
 */
import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import UserProduct from '../src/models/UserProduct';
import Standee from '../src/models/Standee';
import AnalyticsLog from '../src/models/AnalyticsLog';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm');
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
