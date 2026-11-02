/**
 * Phase G — pure tenant rollout decision matrix and allowlist validation.
 */

import assert from 'node:assert/strict';
import {
  evaluateCentralIntegrationRollout,
  parseReviewRolloutMode,
  parseTenantAllowlist,
  TENANT_ID_PATTERN,
  type ReviewRolloutMode,
} from '@/lib/services/review-rollout';

const A = '0000000000000000000b1001';
const B = '0000000000000000000b1002';

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
function decision(input: {
  globalEnabled: boolean;
  mode: ReviewRolloutMode;
  allowlist?: string[];
  tenantId: unknown;
}) {
  return evaluateCentralIntegrationRollout({
    globalEnabled: input.globalEnabled,
    mode: input.mode,
    allowlist: new Set(input.allowlist ?? []),
    tenantId: input.tenantId,
  });
}

check('default mode is legacy-global', () => {
  assert.equal(parseReviewRolloutMode(undefined), 'legacy-global');
  assert.equal(parseReviewRolloutMode(''), 'legacy-global');
});
check('tenant-allowlist mode parses', () => {
  assert.equal(parseReviewRolloutMode('tenant-allowlist'), 'tenant-allowlist');
});
check('disabled mode parses', () => {
  assert.equal(parseReviewRolloutMode('disabled'), 'disabled');
});
check('unknown mode fails closed to disabled', () => {
  assert.equal(parseReviewRolloutMode('allow-everyone'), 'disabled');
});
check('allowlist ignores malformed, short and non-hex entries', () => {
  const parsed = parseTenantAllowlist(` ${A},bad,short,${B},${A},zzzzzzzzzzzzzzzzzzzzzzzz `);
  assert.equal(parsed.size, 2);
  assert.ok(parsed.has(A));
  assert.ok(parsed.has(B));
});
check('allowlist is case-insensitive and deduplicates', () => {
  const parsed = parseTenantAllowlist(`${A.toUpperCase()},${A.toLowerCase()},${A}`);
  assert.equal(parsed.size, 1);
});
check('tenant IDs must be 24 hex characters', () => {
  assert.equal(TENANT_ID_PATTERN.test(A), true);
  assert.equal(TENANT_ID_PATTERN.test('123'), false);
  assert.equal(TENANT_ID_PATTERN.test('z'.repeat(24)), false);
});

check('global OFF + allowed tenant = OFF', () => {
  const result = decision({ globalEnabled: false, mode: 'tenant-allowlist', allowlist: [A], tenantId: A });
  assert.equal(result.effective, false);
  assert.equal(result.reason, 'global_off');
});
check('global OFF + non-allowed tenant = OFF', () => {
  const result = decision({ globalEnabled: false, mode: 'tenant-allowlist', allowlist: [A], tenantId: B });
  assert.equal(result.effective, false);
});
check('global ON + tenant allowlist + allowed = ON', () => {
  const result = decision({ globalEnabled: true, mode: 'tenant-allowlist', allowlist: [A], tenantId: A });
  assert.equal(result.effective, true);
  assert.equal(result.reason, 'tenant_allowlisted');
});
check('global ON + tenant allowlist + non-allowed = OFF', () => {
  const result = decision({ globalEnabled: true, mode: 'tenant-allowlist', allowlist: [A], tenantId: B });
  assert.equal(result.effective, false);
  assert.equal(result.reason, 'tenant_not_allowlisted');
});
check('global ON + empty allowlist = OFF', () => {
  const result = decision({ globalEnabled: true, mode: 'tenant-allowlist', allowlist: [], tenantId: A });
  assert.equal(result.effective, false);
});
check('global ON + missing tenant = OFF in allowlist mode', () => {
  for (const tenantId of [null, undefined, '', 'not-an-object-id']) {
    const result = decision({ globalEnabled: true, mode: 'tenant-allowlist', allowlist: [A], tenantId });
    assert.equal(result.effective, false);
  }
});
check('global ON + legacy-global mode preserves historical ON', () => {
  const result = decision({ globalEnabled: true, mode: 'legacy-global', allowlist: [], tenantId: B });
  assert.equal(result.effective, true);
  assert.equal(result.reason, 'legacy_global');
});
check('disabled policy forces OFF even when global ON and tenant allowed', () => {
  const result = decision({ globalEnabled: true, mode: 'disabled', allowlist: [A], tenantId: A });
  assert.equal(result.effective, false);
  assert.equal(result.reason, 'policy_disabled');
});
check('duplicate allowlist entries do not change decisions', () => {
  const parsed = parseTenantAllowlist(`${A},${A},${A}`);
  const result = decision({ globalEnabled: true, mode: 'tenant-allowlist', allowlist: [...parsed], tenantId: A });
  assert.equal(result.effective, true);
});

console.log('\n=== PHASE G ROLLOUT MATRIX SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failures, failed: failures }, null, 2));
process.exit(failures === 0 ? 0 : 1);
