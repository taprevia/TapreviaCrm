/**
 * Focused local checks for the shared Business Logo infrastructure.
 * Pure/static only: no DB, cloud, server, or browser access.
 */
import assert from 'node:assert/strict';
import Card from '@/models/Card';
import { toPublicCardDto } from '@/lib/dto/card.dto';
import {
  isSafeLogoUrl,
  mediaKeyFromLogoUrl,
  safeLogoUrl,
} from '@/lib/safe-url';
import { updateCardSchema } from '@/lib/validation/card';
import { mediaCategorySchema } from '@/lib/validation/media';

const VALID_MEDIA_URL =
  '/media/0123456789abcdef01234567/2026-11/12345678-1234-4234-8234-123456789abc.webp';
const VALID_KEY =
  '0123456789abcdef01234567/2026-11/12345678-1234-4234-8234-123456789abc.webp';

let checks = 0;
let failures = 0;
function check(name: string, fn: () => void) {
  checks += 1;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

check('logo media category is accepted and unknown categories stay rejected', () => {
  assert.equal(mediaCategorySchema.safeParse('logo').success, true);
  assert.equal(mediaCategorySchema.safeParse('svg').success, false);
});

check('Card.logoUrl is optional with no default', () => {
  const logoPath = Card.schema.path('logoUrl') as unknown as
    | { isRequired?: boolean; defaultValue?: unknown }
    | undefined;
  assert.ok(logoPath);
  assert.notEqual(logoPath.isRequired, true);
  assert.equal(logoPath.defaultValue, undefined);
});

check('safe logo helper accepts empty, strict media, and http(s) URLs', () => {
  assert.equal(isSafeLogoUrl(''), true);
  assert.equal(isSafeLogoUrl(VALID_MEDIA_URL), true);
  assert.equal(isSafeLogoUrl('https://cdn.example.com/logo.png'), true);
  assert.equal(safeLogoUrl(undefined), '');
  assert.equal(safeLogoUrl('   '), '');
});

check('safe logo helper rejects unsafe schemes and malformed media paths', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    '//cdn.example.com/logo.png',
    '/uploads/logo.webp',
    '/media/0123456789abcdef01234567/2026-11/logo.webp?x=1',
    '/media/0123456789abcdef01234567/2026-11/../logo.webp',
    '/media/0123456789abcdef01234567/2026-11/logo.svg',
    '/media/0123456789abcdef01234567/2026-11/logo.webp#x',
  ]) {
    assert.equal(isSafeLogoUrl(value), false, value);
    assert.equal(safeLogoUrl(value), '', value);
  }
});

check('strict media key extraction rejects permissive prefix matches', () => {
  assert.equal(mediaKeyFromLogoUrl(VALID_MEDIA_URL), VALID_KEY);
  assert.equal(mediaKeyFromLogoUrl('/media//logo.webp'), null);
  assert.equal(mediaKeyFromLogoUrl('https://example.com/media/x.webp'), null);
});

check('card update schema accepts absent, empty, valid media, and http(s) logos', () => {
  for (const payload of [
    {},
    { logoUrl: '' },
    { logoUrl: VALID_MEDIA_URL },
    { logoUrl: 'https://cdn.example.com/logo.png' },
  ]) {
    assert.equal(updateCardSchema.safeParse(payload).success, true, JSON.stringify(payload));
  }
});

check('card update schema rejects unsafe logo values', () => {
  for (const logoUrl of [
    'javascript:alert(1)',
    '//cdn.example.com/logo.png',
    '/media/../logo.webp',
    '/media/0123456789abcdef01234567/2026-11/logo.svg',
    'ftp://example.com/logo.png',
  ]) {
    assert.equal(updateCardSchema.safeParse({ logoUrl }).success, false, logoUrl);
  }
});

check('card update schema strips unknown fields', () => {
  const parsed = updateCardSchema.parse({
    logoUrl: VALID_MEDIA_URL,
    injectedField: 'nope',
  }) as Record<string, unknown>;
  assert.equal(parsed.logoUrl, VALID_MEDIA_URL);
  assert.equal('injectedField' in parsed, false);
});

check('public DTO maps valid logos and normalizes absent/unsafe values', () => {
  assert.equal(toPublicCardDto({ name: 'Card', logoUrl: VALID_MEDIA_URL }).logoUrl, VALID_MEDIA_URL);
  assert.equal(toPublicCardDto({ name: 'Card' }).logoUrl, '');
  assert.equal(toPublicCardDto({ name: 'Card', logoUrl: '' }).logoUrl, '');
  assert.equal(toPublicCardDto({ name: 'Card', logoUrl: 'javascript:alert(1)' }).logoUrl, '');
});

console.log('\n=== BUSINESS LOGO PURE SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failures, failed: failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
