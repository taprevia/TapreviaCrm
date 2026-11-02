/**
 * Targeted repair for Admin Products ↔ Create User catalog drift.
 *
 * Inserts only MISSING canonical CatalogProduct documents derived from the
 * code catalog. It never deletes, resets, overwrites, or deactivates existing
 * records (including legacy/QA rows), and never changes existing IDs.
 *
 * Local-only, explicit write confirmation:
 *   npx tsx scripts/repair-catalog-selection.ts --yes
 *   npx tsx scripts/repair-catalog-selection.ts --dry-run
 */

import mongoose from 'mongoose';
import CatalogProduct from '../src/models/CatalogProduct';
import { ALL_PRODUCT_IDS, PRODUCT_CATALOG } from '../src/config/products';
import {
  assertScriptWriteGuard,
  formatTargetSummary,
  hasFlag,
  parseMongoTarget,
} from '../src/lib/ops-script-safety';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const args = process.argv.slice(2);
const dryRun = hasFlag(args, '--dry-run');

let target: ReturnType<typeof parseMongoTarget>;
try {
  target = parseMongoTarget(MONGODB_URI, process.env.MONGODB_DB);
  if (target.isRemote) {
    throw new Error('Refusing a remote MongoDB target; this repair is local-only.');
  }
  if (!dryRun) {
    assertScriptWriteGuard(target, {
      allowRemote: false,
      remoteConfirmed: false,
      writeConfirmed: hasFlag(args, '--yes') || process.env.CONFIRM_DB_WRITE === target.dbName,
    });
  }
} catch (error) {
  console.error(`[repair-catalog] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const KIND_BY_PRODUCT: Record<string, string> = {
  BUSINESS_NFC_CARD: 'profile',
  PREMIUM_NFC_CARD: 'profile',
  INSTA_CARD: 'social',
  GOOGLE_REVIEW_CARD: 'review',
  LINKEDIN_CARD: 'social',
  FACEBOOK_CARD: 'social',
  GOOGLE_REVIEW_STANDEE: 'standee',
  BUSINESS_PROFILE_STANDEE: 'standee',
  ALL_IN_ONE_STANDEE_3: 'standee',
  ALL_IN_ONE_STANDEE_4: 'standee',
  GOOGLE_REVIEW_NFC_PLATE: 'review',
};

const PRICE_BY_PRODUCT: Record<string, number> = {
  BUSINESS_NFC_CARD: 99900,
  PREMIUM_NFC_CARD: 199900,
  INSTA_CARD: 149900,
  GOOGLE_REVIEW_CARD: 149900,
  LINKEDIN_CARD: 149900,
  FACEBOOK_CARD: 149900,
  GOOGLE_REVIEW_STANDEE: 249900,
  BUSINESS_PROFILE_STANDEE: 249900,
  ALL_IN_ONE_STANDEE_3: 399900,
  ALL_IN_ONE_STANDEE_4: 499900,
  GOOGLE_REVIEW_NFC_PLATE: 299900,
};

const CATEGORY_MAP: Record<string, string> = {
  nfc_card: 'card',
  standee: 'standee',
  plate: 'card',
};

function canonicalItem(id: string, index: number) {
  const def = PRODUCT_CATALOG[id as keyof typeof PRODUCT_CATALOG];
  return {
    slug: id.toLowerCase().replace(/_/g, '-'),
    name: def.name,
    description: def.description,
    category: CATEGORY_MAP[def.category] ?? 'card',
    kind: KIND_BY_PRODUCT[id] ?? 'profile',
    priceMinor: PRICE_BY_PRODUCT[id] ?? 99900,
    currency: 'INR',
    imageUrl: '',
    active: true,
    sortOrder: index + 1,
  };
}

async function main() {
  console.log(`[repair-catalog] ${formatTargetSummary(target)} action=${dryRun ? 'dry-run' : 'insert-missing-only'}`);
  await mongoose.connect(MONGODB_URI);
  let inserted = 0;
  let existing = 0;
  for (const [index, id] of ALL_PRODUCT_IDS.entries()) {
    const item = canonicalItem(id, index);
    const found = await CatalogProduct.findOne({ slug: item.slug }).select('_id active').lean<{ _id: unknown; active?: boolean } | null>();
    if (found) {
      existing += 1;
      console.log(`[repair-catalog] EXISTS ${item.slug} active=${found.active !== false}`);
      continue;
    }
    if (dryRun) {
      console.log(`[repair-catalog] WOULD INSERT ${item.slug}`);
      inserted += 1;
      continue;
    }
    await CatalogProduct.create(item);
    inserted += 1;
    console.log(`[repair-catalog] INSERTED ${item.slug}`);
  }
  console.log(JSON.stringify({ dryRun, inserted, existing, totalCanonical: ALL_PRODUCT_IDS.length }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('[repair-catalog] failed:', error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
