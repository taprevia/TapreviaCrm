/**
 * Phase 2A-1 pure tests — no database, no writes, no network.
 *
 * Covers canonical Standee path parsing, sequence mapping, identity matching,
 * and normalization primitives used by the permanent URL reservation service.
 */
import assert from 'node:assert/strict';
import PublicUrlReservation from '@/models/PublicUrlReservation';
import {
  isCanonicalStandeePublicSlug,
  normalizePublicSlug,
  parseStandeePublicSlug,
  reservationIdentityMatches,
  standeePathForSequence,
  standeeSuffixFromPublicSlug,
} from '@/lib/services/public-url-reservation';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(name);
    console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

check('normalizes leading slash and case for comparison only', () => {
  assert.equal(normalizePublicSlug('/ACME/STANDEE-2'), 'acme/standee-2');
  assert.equal(normalizePublicSlug('  acme/standee  '), 'acme/standee');
});

check('accepts canonical first Standee path', () => {
  assert.deepEqual(parseStandeePublicSlug('acme/standee'), {
    path: 'acme/standee',
    bizSlug: 'acme',
    suffix: 1,
  });
  assert.equal(isCanonicalStandeePublicSlug('acme/standee'), true);
});

check('accepts canonical suffixed Standee paths', () => {
  assert.equal(standeeSuffixFromPublicSlug('acme/standee-2'), 2);
  assert.equal(standeeSuffixFromPublicSlug('acme/standee-99'), 99);
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-2'), true);
});

check('rejects non-positive and zero-padded suffixes', () => {
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-0'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-01'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-1'), true);
});

check('rejects extra segments, Card paths, uppercase, and leading slash', () => {
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-2/extra'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/business-card'), false);
  assert.equal(isCanonicalStandeePublicSlug('ACME/STANDEE'), false);
  assert.equal(isCanonicalStandeePublicSlug('/acme/standee'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/review-standee'), false);
});

check('rejects malformed business and product segments', () => {
  assert.equal(isCanonicalStandeePublicSlug('acme_inc/standee'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/standee%2Fextra'), false);
  assert.equal(isCanonicalStandeePublicSlug('acme/standee-'), false);
});

check('maps sequence 1 to standee and later sequences to suffixes', () => {
  assert.equal(standeePathForSequence('acme', 1), 'acme/standee');
  assert.equal(standeePathForSequence('acme', 2), 'acme/standee-2');
  assert.equal(standeePathForSequence('acme', 10), 'acme/standee-10');
  assert.equal(standeePathForSequence('ACME', 2), 'acme/standee-2');
});

check('rejects invalid sequence/path inputs', () => {
  assert.equal(standeePathForSequence('acme', 0), null);
  assert.equal(standeePathForSequence('acme', -1), null);
  assert.equal(standeePathForSequence('acme', 1.5), null);
  assert.equal(standeePathForSequence('bad_slug', 1), null);
});

check('model declares a unique permanent path index with no TTL', () => {
  const indexes = PublicUrlReservation.schema.indexes() as Array<
    [Record<string, unknown>, Record<string, unknown>]
  >;
  const pathIndex = indexes.find(([key]) => key.path === 1);
  assert.ok(pathIndex, 'path index missing');
  assert.equal(pathIndex[1]?.unique, true);
  assert.equal(pathIndex[1]?.expireAfterSeconds, undefined);
});

check('matches reservation identity exactly', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.equal(
    reservationIdentityMatches({ kind: 'standee', instanceId: id }, 'standee', id),
    true
  );
  assert.equal(
    reservationIdentityMatches({ kind: 'standee', instanceId: id }, 'card', id),
    false
  );
  assert.equal(
    reservationIdentityMatches({ kind: 'standee', instanceId: id }, 'standee', 'other'),
    false
  );
  assert.equal(
    reservationIdentityMatches({ kind: 'standee', instanceId: null }, 'standee', id),
    false
  );
});

console.log(`\nPhase 2A-1 pure reservation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
