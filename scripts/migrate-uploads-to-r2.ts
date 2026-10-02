/**
 * migrate-uploads-to-r2.ts — copy existing local-disk media into the object
 * store under their exact keys so /media/[...key] keeps working unchanged.
 *
 *   MEDIA_DRIVER=s3 \
 *   S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
 *   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com S3_REGION=auto \
 *   MONGODB_URI=<atlas srv> \
 *   npx tsx scripts/migrate-uploads-to-r2.ts [--dry-run]
 *
 * Reads the Media collection from the TARGET database (Atlas) and uploads each
 * missing object from this machine's .data/uploads. Idempotent: objects that
 * already exist in the bucket are skipped.
 */
import mongoose from 'mongoose';
import fsp from 'fs/promises';
import path from 'path';
import Media from '../src/models/Media';
import { getStorage } from '../src/lib/storage';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const ROOT = path.resolve(process.cwd(), '.data', 'uploads');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await mongoose.connect(MONGODB_URI);
  const media = await Media.find({ status: 'ready' }).select('key mime bytes').lean();
  console.log(`Media docs: ${media.length}`);

  const storage = getStorage();
  let copied = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of media) {
    const key = doc.key as string;
    const source = path.join(ROOT, key);

    let hasRemote = false;
    if (!DRY_RUN) {
      try {
        await storage.getObject(key);
        hasRemote = true;
      } catch (err) {
        if ((err as Error)?.message !== 'NOT_FOUND') {
          failed += 1;
          console.error(`  HEAD-FAIL ${key}:`, (err as Error).message);
          continue;
        }
      }
    }
    if (hasRemote) {
      skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [dry] would upload ${key}`);
      continue;
    }
    try {
      const buffer = await fsp.readFile(source);
      await storage.putObject(key, buffer, (doc as unknown as { mime: string }).mime);
      copied += 1;
      console.log(`  copy ${key} (${buffer.length} bytes)`);
    } catch (err) {
      failed += 1;
      console.error(`  FAIL ${key}:`, (err as Error).message);
    }
  }

  console.log(`\nDRY_RUN=${DRY_RUN} — copied=${copied} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error('Migration crashed:', error);
  process.exit(2);
});