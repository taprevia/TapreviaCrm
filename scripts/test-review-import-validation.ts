/**
 * Validation-only check for the review library import schema.
 *
 * Pure (no DB, no network): proves that clean payloads — object-based
 * `scenarios` plus `{businessName}`/`{employee}`/`{service}`/`{keyword}` token
 * strings — import, while raw stringified JSON pasted into `text` is rejected.
 * Also guards the pre-existing markup and unknown-placeholder rules, and
 * round-trips the shipped seed artifact.
 *
 * Run:  npx tsx scripts/test-review-import-validation.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { reviewLibraryImportSchema } from '../src/lib/validation/review-library';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

const CATEGORY = {
  key: 'mobile-repair',
  name: 'Mobile Repair',
  scenarios: [
    { key: 'overall', name: 'Overall experience' },
    { key: 'employee-service', name: 'Employee and service' },
  ],
};

function payloadWithText(text: string) {
  return {
    categories: [CATEGORY],
    templates: [
      {
        key: 'tpl-1',
        categoryKey: 'mobile-repair',
        scenario: 'employee-service',
        language: 'English',
        text,
        length: 'short',
      },
    ],
  };
}

console.log('Valid payloads');
check(
  'object-based scenarios + clean token strings import',
  reviewLibraryImportSchema.safeParse(
    payloadWithText('Great service from {employee} at {businessName}.')
  ).success
);
check(
  'text opening with {employee} token still imports',
  reviewLibraryImportSchema.safeParse(payloadWithText('{employee} was polite and patient.')).success
);
check(
  'text opening with {businessName} token still imports',
  reviewLibraryImportSchema.safeParse(payloadWithText('{businessName} fixed my {service} fast.')).success
);
check(
  'keyword token imports',
  reviewLibraryImportSchema.safeParse(payloadWithText('Service was {keyword} and fair.')).success
);

console.log('Rejected corruption');
const corruptTexts: Array<[string, string]> = [
  ['stringified template array', '[{"key":"a","text":"b"}]'],
  ['stringified object', '{"key":"a","text":"b"}'],
  ['bare array literal', '["a","b"]'],
  ['array with leading whitespace', '   [{"key":"a"}]'],
  ['object with spaced key', '{ "key": "a" }'],
  ['JSON field syntax inline', 'Nice work [{ "key": "a" }]'],
];
for (const [label, text] of corruptTexts) {
  const res = reviewLibraryImportSchema.safeParse(payloadWithText(text));
  check(`rejects ${label}`, !res.success);
  if (res.success) console.error('    unexpectedly accepted:', text);
  else if (!('text' in res.error.flatten().fieldErrors)) {
    console.error('    rejected, but not on the `text` field:', JSON.stringify(res.error.flatten().fieldErrors));
  }
}

console.log('Preserved existing guards');
check(
  'still rejects markup (< > &)',
  !reviewLibraryImportSchema.safeParse(payloadWithText('Parts & labour')).success
);
check(
  'still rejects unknown placeholders',
  !reviewLibraryImportSchema.safeParse(payloadWithText('Hi {name}')).success
);

console.log('Shipped artifact');
const artifact = JSON.parse(
  readFileSync(join(__dirname, 'data', 'review-library-mobile-repair.json'), 'utf8')
) as unknown;
check('seed artifact validates against the import schema', reviewLibraryImportSchema.safeParse(artifact).success);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
