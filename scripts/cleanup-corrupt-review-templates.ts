/**
 * cleanup-corrupt-review-templates.ts — removes review templates whose `text`
 * was populated with a raw stringified JSON array/object instead of plain
 * wording (e.g. `[{"key":"…"}]` or `{"key":"…"}`). Such rows carry no usable
 * review text, so they are deleted rather than sanitized.
 *
 * Safe by default: reports matches without writing. Pass --apply to delete.
 * Matching uses the same `isRawJsonFreeText` guard as the import schema, so a
 * text that merely opens with a legitimate placeholder
 * ({businessName}/{employee}/{service}/{keyword}) is never touched.
 *
 * Run:  MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/cleanup-corrupt-review-templates.ts [--apply]
 */
import mongoose from 'mongoose';
import ReviewTemplate from '../src/models/ReviewTemplate';
import { isRawJsonFreeText } from '../src/lib/services/review-templates';

interface CandidateRow {
  _id: unknown;
  key: string;
  text: string;
}

async function run() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm');

  // Coarse DB prefilter, then the exact shared guard in JS so legitimate
  // placeholder-led rows are never matched.
  const candidates = (await ReviewTemplate.find({
    $or: [
      { text: /^\s*\[/ },
      { text: /^\s*\{\s*["\[]/ },
      { text: /"[A-Za-z_][\w-]*"\s*:/ },
    ],
  })
    .select('key text')
    .lean()
    .exec()) as unknown as CandidateRow[];

  const corrupt = candidates.filter((row) => !isRawJsonFreeText(row.text ?? ''));

  console.log(`Candidates scanned: ${candidates.length}. Corrupt: ${corrupt.length}.`);
  for (const row of corrupt) {
    console.log(`  - ${row.key}: ${JSON.stringify((row.text ?? '').slice(0, 120))}`);
  }

  if (corrupt.length === 0) {
    console.log('Nothing to clean.');
  } else if (!apply) {
    console.log('\nDry run — re-run with --apply to delete the rows above.');
  } else {
    const res = await ReviewTemplate.deleteMany({ _id: { $in: corrupt.map((row) => row._id) } });
    console.log(`Deleted ${res.deletedCount} corrupt template(s).`);
  }

  await mongoose.disconnect();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
