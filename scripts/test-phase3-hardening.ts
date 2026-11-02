/**
 * Phase 3 hardening regression tests — PURE ONLY.
 *
 * No database connection, no network, no filesystem writes. Safe to run with:
 *   npx tsx scripts/test-phase3-hardening.ts
 */

import assert from 'node:assert/strict';
import {
  OpsScriptSafetyError,
  assertScriptWriteGuard,
  formatTargetSummary,
  parseMigrationArgs,
  parseMongoTarget,
} from '../src/lib/ops-script-safety';
import {
  MAX_SEARCH_LENGTH,
  escapeRegExp,
  literalSearchRegExp,
  normalizeSearchInput,
} from '../src/lib/search';
import {
  isSupportedGoogleReviewUrl,
} from '../src/lib/validation/google-review-url';
import { safePostLoginRedirect } from '../src/lib/safe-redirect';
import { checkRuntimeConfig } from '../src/lib/runtime-config';
import { normalizeVcfContact } from '../src/lib/validation/vcf-contact';
import { shouldShowPremiumReviewSection } from '../src/lib/services/review-ui';
import { reviewAssistantPartialSchema } from '../src/lib/validation/card';
import { resolvePrimaryDatabaseName } from '../src/lib/db-target';

let checks = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Script safety ───────────────────────────────────────────────────────────
check('local target resolves explicit database', () => {
  const target = parseMongoTarget('mongodb://localhost:27017/nfc-crm');
  assert.equal(target.dbName, 'nfc-crm');
  assert.equal(target.isRemote, false);
  assert.match(formatTargetSummary(target), /host=localhost db=nfc-crm scope=local/);
});

check('URI path and MONGODB_DB disagreement is rejected', () => {
  assert.throws(
    () => parseMongoTarget('mongodb://localhost:27017/nfc-crm', 'other'),
    OpsScriptSafetyError
  );
});

check('missing and reserved database names are rejected', () => {
  assert.throws(() => parseMongoTarget('mongodb://localhost:27017'), OpsScriptSafetyError);
  assert.throws(() => parseMongoTarget('mongodb://localhost:27017/admin'), OpsScriptSafetyError);
});

check('remote target needs allow + confirm + write', () => {
  const target = parseMongoTarget('mongodb+srv://user:pass@cluster.example.net/preview');
  assert.equal(target.isRemote, true);
  assert.throws(
    () => assertScriptWriteGuard(target, { allowRemote: false, remoteConfirmed: false, writeConfirmed: false }),
    OpsScriptSafetyError
  );
  assert.throws(
    () => assertScriptWriteGuard(target, { allowRemote: true, remoteConfirmed: false, writeConfirmed: true }),
    OpsScriptSafetyError
  );
  assert.throws(
    () => assertScriptWriteGuard(target, { allowRemote: true, remoteConfirmed: true, writeConfirmed: false }),
    OpsScriptSafetyError
  );
  assert.doesNotThrow(() =>
    assertScriptWriteGuard(target, { allowRemote: true, remoteConfirmed: true, writeConfirmed: true })
  );
});

check('migration arguments have no destructive defaults', () => {
  assert.throws(() => parseMigrationArgs([]), OpsScriptSafetyError);
  const dry = parseMigrationArgs(['--source-db=one', '--target-db=two']);
  assert.equal(dry.source, 'one');
  assert.deepEqual(dry.targets, ['two']);
  assert.equal(dry.write, false);
  const write = parseMigrationArgs(['--source-db=one', '--target-db=two', '--write']);
  assert.equal(write.write, true);
  assert.throws(
    () => parseMigrationArgs(['--source-db=one', '--target-db=one']),
    OpsScriptSafetyError
  );
  assert.throws(
    () => parseMigrationArgs(['--source-db=one', '--target-db=two', '--unknown']),
    OpsScriptSafetyError
  );
  assert.throws(
    () => parseMigrationArgs(['--source-db=one', '--target-db=two', '--target-db=two']),
    OpsScriptSafetyError
  );
  assert.throws(
    () => parseMigrationArgs(['--source-db=one', '--target-db=two', '--dry-run', '--write']),
    OpsScriptSafetyError
  );
});

check('local DB selector resolves explicit nfc-crm', () => {
  assert.equal(
    resolvePrimaryDatabaseName({ explicit: 'nfc-crm', nodeEnv: 'development' }),
    'nfc-crm'
  );
  assert.equal(resolvePrimaryDatabaseName({ nodeEnv: 'development' }), 'taprevia_V2');
});

// ── Search ──────────────────────────────────────────────────────────────────
check('empty and whitespace search means no filter', () => {
  assert.deepEqual(normalizeSearchInput(''), { ok: true, value: null });
  assert.deepEqual(normalizeSearchInput('   '), { ok: true, value: null });
});

check('search whitespace is normalized', () => {
  assert.deepEqual(normalizeSearchInput('  Acme   Corp '), { ok: true, value: 'Acme Corp' });
});

check('normal names, emails and special characters remain literal', () => {
  assert.equal(literalSearchRegExp('John Doe').test('john doe'), true);
  assert.equal(literalSearchRegExp('user@example.com').test('USER@EXAMPLE.COM'), true);
  assert.equal(literalSearchRegExp("O'Brien & Sons").test("o'brien & sons"), true);
  assert.equal(literalSearchRegExp('a.b').test('axb'), false);
});

check('regex metacharacters are escaped', () => {
  const rx = literalSearchRegExp('a+b(c).[d]\\e');
  assert.equal(rx.test('a+b(c).[d]\\e'), true);
  assert.equal(rx.test('aaab(c)'), false);
  assert.equal(escapeRegExp('.*+?^${}()|[]\\'), '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
});

check('overlong search is rejected; max is bounded', () => {
  const result = normalizeSearchInput('x'.repeat(MAX_SEARCH_LENGTH + 1));
  assert.equal(result.ok, false);
  assert.equal(normalizeSearchInput('x'.repeat(MAX_SEARCH_LENGTH)).ok, true);
});

check('unicode search remains literal', () => {
  const rx = literalSearchRegExp('कैफ़े');
  assert.equal(rx.test('कैफ़े'), true);
});

// ── Google review URL policy ────────────────────────────────────────────────
check('supported Google review destinations are accepted', () => {
  for (const url of [
    'https://g.page/r/abc/review',
    'https://maps.app.goo.gl/abc123',
    'https://goo.gl/maps/abc123',
    'https://www.google.com/maps/place/Test',
    'https://google.co.in/maps/place/Test',
    'https://maps.google.co.uk/place/Test',
    'https://search.google.com/local/writereview?placeid=abc',
    '',
    'https://example.test/r/abc/review',
    'https://example.com/m10-review',
  ]) {
    assert.equal(isSupportedGoogleReviewUrl(url), true, url);
  }
});

check('lookalike, credential and non-review Google URLs are rejected', () => {
  for (const url of [
    'https://evilgoogle.com/maps',
    'https://google.com.evil.com/maps',
    'https://google.evil.com/maps',
    'https://maps.google.evil.com/place/Test',
    'https://support.google.com/maps',
    'https://gemini.google.com/app/x',
    'https://www.google.com/search?q=test',
    'https://user:pass@google.com/maps',
    'javascript:alert(1)',
    'ftp://google.com/maps',
  ]) {
    assert.equal(isSupportedGoogleReviewUrl(url), false, url);
  }
});

check('card write schema enforces the Google review policy', () => {
  assert.equal(reviewAssistantPartialSchema.safeParse({ googleReviewUrl: 'https://g.page/r/x/review' }).success, true);
  assert.equal(reviewAssistantPartialSchema.safeParse({ googleReviewUrl: 'https://evil.com/review' }).success, false);
  assert.equal(reviewAssistantPartialSchema.safeParse({ googleReviewUrl: 'https://user:pass@google.com/maps' }).success, false);
  assert.equal(reviewAssistantPartialSchema.safeParse({ googleReviewUrl: '' }).success, true);
});

// ── Login redirect ──────────────────────────────────────────────────────────
check('safe internal redirects are honored', () => {
  assert.equal(safePostLoginRedirect('/dashboard/products/123', 'customer'), '/dashboard/products/123');
  assert.equal(safePostLoginRedirect('/admin/users?x=1', 'admin'), '/admin/users?x=1');
});

check('unsafe redirects fall back to the role dashboard', () => {
  for (const value of [
    'https://evil.com',
    '//evil.com',
    '%2F%2Fevil.com',
    '/\\evil.com',
    '/login',
    '/admin',
    'javascript:alert(1)',
    '/dashboard%0d%0aHeader',
  ]) {
    assert.equal(safePostLoginRedirect(value, 'customer'), '/dashboard', value);
  }
  assert.equal(safePostLoginRedirect(null, 'admin'), '/admin');
});

// ── Runtime config ──────────────────────────────────────────────────────────
check('Preview without MONGODB_DB fails closed', () => {
  const result = checkRuntimeConfig({
    MONGODB_URI: 'mongodb://localhost:27017/x',
    JWT_SECRET: 'x'.repeat(32),
    VERCEL_ENV: 'preview',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues.map((i) => i.name), ['MONGODB_DB']);
});

check('Preview with explicit DB is valid and warns about missing host', () => {
  const result = checkRuntimeConfig({
    MONGODB_URI: 'mongodb://localhost:27017/x',
    MONGODB_DB: 'taprevia-preview',
    JWT_SECRET: 'x'.repeat(32),
    VERCEL_ENV: 'preview',
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.some((w) => w.includes('QR/NFC')), true);
});

check('local development without DB remains valid', () => {
  const result = checkRuntimeConfig({
    MONGODB_URI: 'mongodb://localhost:27017/x',
    JWT_SECRET: 'x'.repeat(32),
    NODE_ENV: 'development',
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 0);
});

check('production missing DB/APP_KEY warns but does not fail', () => {
  const result = checkRuntimeConfig({
    MONGODB_URI: 'mongodb://localhost:27017/x',
    JWT_SECRET: 'x'.repeat(32),
    VERCEL_ENV: 'production',
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 2);
});

// ── VCF contact ─────────────────────────────────────────────────────────────
check('VCF accepts Unicode names and international phones', () => {
  const result = normalizeVcfContact({
    name: '  आरव   शर्मा ',
    email: 'User@Example.com ',
    phone: '+91 (98765) 43210',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.contact.name, 'आरव शर्मा');
    assert.equal(result.contact.email, 'user@example.com');
    assert.equal(result.contact.phone, '+91 (98765) 43210');
  }
});

check('VCF rejects invalid email and phone', () => {
  assert.equal(normalizeVcfContact({ name: 'A', email: 'not-an-email' }).ok, false);
  assert.equal(normalizeVcfContact({ name: 'A', email: 'a@b.co', phone: 'call-me' }).ok, false);
  assert.equal(normalizeVcfContact({ name: 'A'.repeat(101), email: 'a@b.co' }).ok, false);
});

// ── Review UI eligibility ───────────────────────────────────────────────────
check('premium review section uses card identity, not catalog kind', () => {
  assert.equal(shouldShowPremiumReviewSection({ eligible: true, cardKind: 'profile' }), true);
  assert.equal(shouldShowPremiumReviewSection({ eligible: true, cardKind: 'review' }), false);
  assert.equal(shouldShowPremiumReviewSection({ eligible: true, cardKind: '' }), false);
  assert.equal(shouldShowPremiumReviewSection({ eligible: false, cardKind: 'profile' }), false);
  assert.equal(shouldShowPremiumReviewSection(null), false);
});

console.log(`\n=== PHASE 3 HARDENING SUMMARY ===`);
console.log(JSON.stringify({ checks, passed: checks - failed, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
