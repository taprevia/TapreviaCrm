/**
 * Phase 4D.10 Gate P2.4 — builder active-tab regression tests.
 *
 * Reproduces the removed-Review-Assistant / invalid-tab crash conditions and
 * proves the canonical resolver never returns undefined for a non-empty tab set.
 */

import assert from 'node:assert/strict';
import { resolveActiveBuilderTab } from '../src/lib/builder-tab-state';

let passed = 0;
const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const profileTabs = [{ key: 'basic' }, { key: 'about' }, { key: 'theme' }];
const reviewTabs = [{ key: 'basic' }, { key: 'reviews' }];
const socialTabs = [{ key: 'social-destination' }];

check('empty tab list returns null (renderer must show an empty state)', () => {
  assert.equal(resolveActiveBuilderTab([], 'basic'), null);
});
check('valid requested tab is preserved', () => {
  assert.equal(resolveActiveBuilderTab(profileTabs, 'about')?.key, 'about');
});
check('invalid requested tab falls back to the product default', () => {
  assert.equal(resolveActiveBuilderTab(profileTabs, 'does-not-exist')?.key, 'basic');
});
check('removed review-assistant key maps to Reviews for review products', () => {
  assert.equal(resolveActiveBuilderTab(reviewTabs, 'review-assistant')?.key, 'reviews');
});
check('removed review-assistant key maps to Details when no Reviews tab exists', () => {
  assert.equal(resolveActiveBuilderTab(profileTabs, 'review-assistant')?.key, 'basic');
});
check('review product default is a valid Details tab', () => {
  assert.equal(resolveActiveBuilderTab(reviewTabs, undefined)?.key, 'basic');
});
check('product switching to a tab set without the old key is safe', () => {
  const resolved = resolveActiveBuilderTab(socialTabs, 'theme');
  assert.equal(resolved?.key, 'social-destination');
});
check('every non-empty supported product configuration resolves to a tab', () => {
  for (const tabs of [profileTabs, reviewTabs, socialTabs]) {
    for (const requested of [undefined, '', 'basic', 'reviews', 'review-assistant', 'bogus']) {
      const resolved = resolveActiveBuilderTab(tabs, requested);
      assert.ok(resolved, `resolved undefined for ${requested}`);
      assert.ok(tabs.some((tab) => tab.key === resolved.key), 'resolved a fabricated tab');
    }
  }
});
check('whitespace request falls back safely', () => {
  assert.equal(resolveActiveBuilderTab(profileTabs, '   ')?.key, 'basic');
});

console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length) {
  for (const failure of failures) console.log(`- ${failure}`);
  process.exit(1);
}
