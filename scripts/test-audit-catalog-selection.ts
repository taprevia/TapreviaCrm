/**
 * Read-only regression check for the Admin Products ↔ Create User catalog bug.
 *
 * Verifies every canonical code product has an active CatalogProduct DB row
 * and reports legacy/QA rows preserved. Refuses remote targets and never writes.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import CatalogProduct from '../src/models/CatalogProduct';
import { ALL_PRODUCT_IDS } from '../src/config/products';
import { parseMongoTarget } from '../src/lib/ops-script-safety';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';

async function main() {
  const target = parseMongoTarget(MONGODB_URI, process.env.MONGODB_DB);
  if (target.isRemote) throw new Error('Refusing remote MongoDB target');
  await mongoose.connect(MONGODB_URI);
  const canonicalSlugs = ALL_PRODUCT_IDS.map((id) => id.toLowerCase().replace(/_/g, '-'));
  const rows = await CatalogProduct.find({ slug: { $in: canonicalSlugs } })
    .select('slug name active sortOrder')
    .lean<Array<{ slug: string; name: string; active?: boolean; sortOrder?: number }>>();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const missing = canonicalSlugs.filter((slug) => !bySlug.has(slug));
  const inactive = canonicalSlugs.filter((slug) => bySlug.get(slug)?.active === false);
  const allRows = await CatalogProduct.find({}).select('slug active').lean<Array<{ slug: string; active?: boolean }>>();
  const legacyRows = allRows.filter((row) => !canonicalSlugs.includes(row.slug));

  assert.equal(missing.length, 0, `Missing canonical catalog products: ${missing.join(', ')}`);
  assert.equal(inactive.length, 0, `Inactive canonical catalog products: ${inactive.join(', ')}`);
  assert.equal(new Set(allRows.map((r) => r.slug)).size, allRows.length, 'Duplicate catalog slugs detected');

  console.log(JSON.stringify({
    canonical: canonicalSlugs.length,
    canonicalPresent: rows.length,
    legacyOrNonCanonicalPreserved: legacyRows.length,
    missing,
    inactive,
  }, null, 2));
  console.log('PASS admin catalog selection source is synchronized');
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('FAIL admin catalog selection regression:', error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
