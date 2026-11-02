/**
 * Phase audit pure regression checks for the safe repair set.
 */
import assert from 'node:assert/strict';
import { isBcryptHash } from '@/models/User';
import { updateProductConfigSchema } from '@/lib/validation/product-config';
import { getPublicProductSlug, RESERVED_PUBLIC_SEGMENTS } from '@/lib/services/human-url';
import { resolveCanonicalProductId } from '@/lib/services/product-identity';

let checks = 0;
let failures = 0;
function check(name: string, fn: () => void) {
  checks += 1;
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures += 1; console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`); }
}

check('blank WhatsApp is accepted as a clear operation', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '', defaultMessage: '' } });
  assert.equal(parsed.success, true);
});
check('invalid short WhatsApp is still rejected', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '123', defaultMessage: '' } });
  assert.equal(parsed.success, false);
});
check('valid WhatsApp is accepted', () => {
  const parsed = updateProductConfigSchema.safeParse({ whatsapp: { phoneNumber: '+919876543210', defaultMessage: 'Hi' } });
  assert.equal(parsed.success, true);
});
check('legacy premium-card slug canonicalizes and allocates public slug', () => {
  assert.equal(resolveCanonicalProductId('premium-card'), 'PREMIUM_NFC_CARD');
  assert.equal(getPublicProductSlug('premium-card'), 'premium-card');
});
check('standee-review is reserved from business slug allocation', () => {
  assert.equal(RESERVED_PUBLIC_SEGMENTS.has('standee-review'), true);
  assert.equal(RESERVED_PUBLIC_SEGMENTS.has('contacts'), true);
});
check('full bcrypt hashes are recognized; prefixes are not', () => {
  assert.equal(isBcryptHash('$2b$12$' + 'a'.repeat(53)), true);
  assert.equal(isBcryptHash('$2b$12$'), false);
  assert.equal(isBcryptHash('$2b$not-a-full-hash'), false);
});

console.log('\n=== AUDIT PURE SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failures, failed: failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
