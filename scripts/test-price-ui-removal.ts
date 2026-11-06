/**
 * Presentation-only price guard.
 *
 * Read-only static verification: no DB, network or filesystem writes.
 * Proves that product-price output stays gone from the public/marketing/admin
 * surfaces, while the builder's Premium NFC product editor has its INR price
 * input restored and the pricing fields/backend contracts remain intact.
 *
 * Run: npx tsx scripts/test-price-ui-removal.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

const UI_FILES = [
  'src/app/(admin)/admin/users/page.tsx',
  'src/app/(admin)/admin/users/[id]/page.tsx',
  'src/components/marketing/ui/ProductCard.tsx',
  'src/components/marketing/ui/ProductModal.tsx',
  'src/app/(public)/page.tsx',
  'src/app/(public)/contacts/page.tsx',
];

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

check('affected UI no longer renders a rupee price or price formatter', () => {
  for (const file of UI_FILES) {
    const text = read(file);
    assert.equal(text.includes('₹'), false, `${file} still renders ₹`);
    assert.equal(text.includes('formatPriceMinor'), false, `${file} still calls formatPriceMinor`);
    assert.equal(/originalPrice\s*[.}{]/.test(text), false, `${file} still reads originalPrice`);
  }
});

check('builder restores the INR price input but keeps currency editing hidden', () => {
  const text = read('src/components/builder/tabs/products-tab.tsx');
  assert.match(text, /id="product-price"/);
  assert.match(text, /type="number"/);
  assert.match(text, /step="0\.01"/);
  assert.match(text, /Price \(₹\)/);
  assert.match(text, /priceMajor/);
  assert.match(text, /body\.priceMinor/);
  assert.equal(/product-currency|body\.currency/.test(text), false, 'currency editing must stay hidden');
});

check('marketing cards/modal no longer print product prices or discounts', () => {
  for (const file of [
    'src/components/marketing/ui/ProductCard.tsx',
    'src/components/marketing/ui/ProductModal.tsx',
  ]) {
    const text = read(file);
    assert.equal(/Save\s*₹|% off|Best Price|Order on WhatsApp\s*—/.test(text), false, file);
    assert.equal(/price:\s*product\.price/.test(text), false, `${file} still passes price to WhatsApp`);
  }
});

check('product pricing fields remain in models and data (no schema/data removal)', () => {
  assert.match(read('src/models/CatalogProduct.ts'), /priceMinor:/);
  assert.match(read('src/models/CatalogProduct.ts'), /currency:/);
  assert.match(read('src/models/Product.ts'), /priceMinor:/);
  assert.match(read('src/lib/marketing/products.ts'), /price:\s*\d+/);
  assert.match(read('src/lib/format.ts'), /export function formatPriceMinor/);
});

check('admin catalog API still returns full catalog documents', () => {
  const text = read('src/app/api/admin/catalog/route.ts');
  assert.match(text, /CatalogProduct\.find\(\)/);
  assert.equal(/select\([^)]*priceMinor/.test(text), false, 'catalog API unexpectedly narrows fields');
});

console.log(`\nRESULT: ${passed} passed, 0 failed`);
