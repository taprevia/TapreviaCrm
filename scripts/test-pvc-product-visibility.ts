/**
 * Customer product visibility — PVC removal guard.
 *
 * Read-only unit verification: no DB, network or filesystem writes.
 * Run: npx tsx scripts/test-pvc-product-visibility.ts
 */

import assert from 'node:assert/strict';
import { PRODUCTS } from '@/lib/marketing/products';
import {
  HIDDEN_PVC_PRODUCT_IDS,
  filterCustomerVisibleProducts,
  isCustomerVisibleProduct,
  isHiddenPvcProduct,
} from '@/lib/marketing/product-visibility';
import type { Product } from '@/types/marketing';
import fs from 'node:fs';
import { ALL_PRODUCT_IDS, PRODUCT_CATALOG } from '@/config/products';
import { assignProductSchema } from '@/lib/validation/catalog';

function product(overrides: Partial<Product>): Product {
  return {
    id: 'sample',
    name: 'Sample Product',
    price: 1,
    rating: 5,
    reviewsCount: 0,
    category: 'NFC Card',
    image: '/sample.webp',
    images: ['/sample.webp'],
    features: [],
    ...overrides,
  };
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check('no PVC product in customer marketing catalog', () => {
  const pvc = PRODUCTS.filter(
    (item) => /^pvc(?:\s|$|-)/i.test(item.name.trim()) || /^pvc(?:-|$)/i.test(item.id)
  );
  assert.equal(pvc.length, 0, `PVC products still visible: ${pvc.map((p) => p.name).join(', ')}`);
});

check('known active products remain visible', () => {
  for (const id of [
    'business-nfc-card',
    'premium-nfc-card',
    'insta-card',
    'google-review-card',
    'linkedin-card',
    'facebook-card',
    'metal-nfc-card',
    'wooden-nfc-card',
    'google-review-standee',
    'google-review-nfc-plate',
  ]) {
    assert.ok(PRODUCTS.some((p) => p.id === id), `${id} hidden unexpectedly`);
  }
});

check('PVC-named definitions are filtered centrally', () => {
  const hidden = [
    product({ id: 'pvc', name: 'PVC Card' }),
    product({ id: 'pvc-nfc-card', name: 'PVC NFC Card' }),
    product({ id: 'legacy-pvc', name: 'PVC Business Card' }),
    product({ id: 'legacy', name: 'PVC' }),
  ];
  for (const item of hidden) assert.equal(isCustomerVisibleProduct(item), false, item.name);
  assert.equal(filterCustomerVisibleProducts(hidden).length, 0);
});

check('admin catalog records use the same exact PVC rule', () => {
  const hidden = [
    { slug: 'pvc', name: 'PVC' },
    { slug: 'pvc-card', name: 'PVC Card' },
    { slug: 'pvc-nfc-card', name: 'PVC NFC Card' },
    { slug: 'pvc-business-card', name: 'PVC Business Card' },
    { slug: 'pvc-nfc-business-card', name: 'PVC NFC Business Card' },
    { slug: 'legacy-row', name: 'PVC Custom Row' },
  ];
  for (const row of hidden) assert.equal(isHiddenPvcProduct(row), true, row.slug);

  const visible = [
    { slug: 'business-nfc-card', name: 'Business NFC Card' },
    { slug: 'premium-nfc-card', name: 'Premium NFC Card' },
    { slug: 'metal-nfc-card', name: 'Metal NFC Card' }, // material, not product
    { slug: 'google-review-standee', name: 'Google Review Standee' },
  ];
  for (const row of visible) assert.equal(isHiddenPvcProduct(row), false, row.slug);

  // A PVC-free product is not a PVC Card product and must stay visible.
  assert.equal(isHiddenPvcProduct({ slug: 'pvc-free-card', name: 'PVC-Free Card' }), false);
  assert.equal(isHiddenPvcProduct({ slug: 'pvc-free-card', name: 'PVC free Card' }), false);

  assert.deepEqual(
    [...HIDDEN_PVC_PRODUCT_IDS].sort(),
    ['pvc', 'pvc-business-card', 'pvc-card', 'pvc-nfc-business-card', 'pvc-nfc-card']
  );
});

check('material metadata is not mistaken for a product', () => {
  const metal = product({ id: 'metal-nfc-card', name: 'Metal NFC Card' });
  const business = product({ id: 'business-nfc-card', name: 'Business NFC Card' });
  assert.equal(isCustomerVisibleProduct(metal), true);
  assert.equal(isCustomerVisibleProduct(business), true);
});

check('product metadata no longer advertises PVC', () => {
  for (const id of ALL_PRODUCT_IDS) {
    const materials = PRODUCT_CATALOG[id].metadata.materials ?? [];
    assert.equal(materials.includes('pvc'), false, `${id} still advertises PVC`);
  }
});

check('new assignments reject PVC and accept valid/omitted material', () => {
  const id = '000000000000000000000001';
  assert.equal(assignProductSchema.safeParse({ catalogProductId: id, material: 'pvc' }).success, false);
  assert.equal(assignProductSchema.safeParse({ catalogProductId: id, material: 'metal' }).success, true);
  assert.equal(assignProductSchema.safeParse({ catalogProductId: id, material: 'wooden' }).success, true);
  assert.equal(assignProductSchema.safeParse({ catalogProductId: id }).success, true);
});

check('no rendered PVC label map remains', () => {
  for (const file of [
    'src/app/(dashboard)/dashboard/products/page.tsx',
    'src/components/dashboard/overview/my-products.tsx',
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.equal(/pvc\s*:\s*['\"]PVC['\"]/i.test(text), false, `${file} still maps PVC`);
  }
});

check('catalog filtering is stable and non-empty', () => {
  assert.ok(PRODUCTS.length > 0);
  assert.deepEqual(PRODUCTS.map((p) => p.id), PRODUCTS.map((p) => p.id));
});

console.log(`\nRESULT: ${passed} passed, 0 failed`);
