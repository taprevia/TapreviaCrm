/**
 * Central AI Review settings regression — pure only.
 * No database, network, provider, or filesystem writes.
 */

import assert from 'node:assert/strict';
import { resolveReviewSettings } from '../src/lib/services/review-settings-resolver';

const central = {
  schemaVersion: 1,
  general: {
    enabled: true,
    googleReviewUrl: 'https://g.page/r/central/review',
    welcomeMessage: 'Central welcome',
    businessName: 'Central Business',
  },
  content: {
    category: 'cafe',
    languages: ['English', 'Hindi'],
    writingStyle: 'professional' as const,
    preferredLength: 'detailed' as const,
    styleMode: 'varied' as const,
    lengthMode: 'varied' as const,
    feedbackTopics: ['service'],
    services: ['Coffee'],
    employees: ['Asha'],
    keywords: ['cosy'],
  },
};

const legacyCard = {
  reviewAssistant: {
    enabled: false,
    googleReviewUrl: '',
    languages: ['English'],
    category: '',
  },
};

let checks = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  checks += 1;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check('central source resolves central category and AI settings', () => {
  const resolved = resolveReviewSettings({
    card: legacyCard,
    source: 'central',
    centralSettings: central,
  });
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.category, 'cafe');
  assert.deepEqual(resolved.languages, ['English', 'Hindi']);
  assert.equal(resolved.writingStyle, 'professional');
  assert.equal(resolved.preferredLength, 'detailed');
  assert.equal(resolved.styleMode, 'varied');
  assert.equal(resolved.googleReviewUrl, 'https://g.page/r/central/review');
  assert.equal(resolved.businessName, 'Central Business');
});

check('legacy source stays legacy until explicit transition', () => {
  const resolved = resolveReviewSettings({
    card: legacyCard,
    source: 'legacy',
    centralSettings: central,
  });
  assert.equal(resolved.enabled, false);
  assert.equal(resolved.category, '');
  assert.equal(resolved.googleReviewUrl, '');
  assert.equal(resolved.businessName, '');
});

check('hybrid overrides central category explicitly', () => {
  const resolved = resolveReviewSettings({
    card: legacyCard,
    source: 'hybrid',
    centralSettings: central,
    overrides: { category: 'retail', languages: ['English'] },
  });
  assert.equal(resolved.category, 'retail');
  assert.deepEqual(resolved.languages, ['English']);
  assert.equal(resolved.enabled, true);
});

console.log('\n=== CENTRAL AI SETTINGS SUMMARY ===');
console.log(JSON.stringify({ checks, passed: checks - failed, failed }, null, 2));
process.exit(failed === 0 ? 0 : 1);
