/**
 * Pure regression checks for Review Library file parsing + normalization.
 * No DB, network, or filesystem writes.
 *
 * Run: npx tsx scripts/test-review-import-payload.ts
 */
import assert from 'node:assert/strict';
import {
  ReviewImportPayloadError,
  parseReviewLibraryImportText,
  toReviewLibraryImportBody,
} from '@/lib/review-library-import-payload';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const CATEGORY = {
  _id: { $oid: '000000000000000000000001' },
  key: 'real-estate',
  name: 'Real Estate',
  active: true,
  languages: ['English'],
  scenarios: [
    { key: 'overall', name: 'Overall experience' },
    { key: 'agent-service', name: 'Agent and service' },
  ],
  __v: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function template(index: number) {
  return {
    _id: { $oid: `${index}`.padStart(24, '0') },
    key: `real-estate-overall-short-friendly-${index}`,
    categoryKey: 'real-estate',
    scenario: 'overall',
    language: 'English',
    text: `Property ${index}: {businessName} helped us find the right home.`,
    variables: ['businessName'],
    length: index % 3 === 0 ? 'short' : index % 3 === 1 ? 'medium' : 'detailed',
    style: index % 2 === 0 ? 'friendly' : 'professional',
    compatibleKeywords: ['property'],
    active: true,
    usageCount: index,
    lastShownAt: null,
    __v: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

check('canonical exported object parses', () => {
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ categories: [CATEGORY], templates: [template(1)] })
  );
  assert.equal(parsed.format, 'object');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 1);
});

check('export metadata is removed before sending', () => {
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ categories: [CATEGORY], templates: [template(2)] })
  );
  const category = parsed.categories[0];
  const tpl = parsed.templates[0];
  for (const key of ['_id', '__v', 'createdAt', 'updatedAt']) {
    assert.equal(Object.prototype.hasOwnProperty.call(category, key), false, `category.${key}`);
    assert.equal(Object.prototype.hasOwnProperty.call(tpl, key), false, `template.${key}`);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(tpl, 'variables'), false);
  assert.deepEqual(toReviewLibraryImportBody(parsed).categories, parsed.categories);
});

check('100 Real Estate templates parse with one category', () => {
  const templates = Array.from({ length: 100 }, (_, i) => template(i + 1));
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ categories: [CATEGORY], templates })
  );
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 100);
  assert.equal(new Set(parsed.templates.map((t) => t.key)).size, 100);
});

check('single array containing category + templates is split', () => {
  const parsed = parseReviewLibraryImportText(
    JSON.stringify([CATEGORY, ...Array.from({ length: 100 }, (_, i) => template(i + 1))])
  );
  assert.equal(parsed.format, 'array');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 100);
});

check('JSON Lines export is accepted', () => {
  const lines = [CATEGORY, ...Array.from({ length: 100 }, (_, i) => template(i + 1))]
    .map((row) => JSON.stringify(row))
    .join('\n');
  const parsed = parseReviewLibraryImportText(lines);
  assert.equal(parsed.format, 'json-lines');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 100);
});

check('concatenated categories/templates fragments are merged', () => {
  const text = `${JSON.stringify({ categories: [CATEGORY] })}\n${JSON.stringify({
    templates: Array.from({ length: 100 }, (_, i) => template(i + 1)),
  })}`;
  const parsed = parseReviewLibraryImportText(text);
  assert.equal(parsed.format, 'json-lines');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 100);
});

check('singular category + templates wrapper is accepted', () => {
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ category: CATEGORY, templates: [template(1)] })
  );
  assert.equal(parsed.format, 'singular-category');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 1);
});

check('wrapped data object is accepted', () => {
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ data: { categories: [CATEGORY], templates: [template(1)] } })
  );
  assert.equal(parsed.format, 'wrapped-object');
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.templates.length, 1);
});

check('BOM-prefixed exported JSON is accepted', () => {
  const parsed = parseReviewLibraryImportText(
    `\uFEFF${JSON.stringify({ categories: [CATEGORY], templates: [template(1)] })}`
  );
  assert.equal(parsed.categories.length, 1);
});

check('legacy empty style/languages are normalized away', () => {
  const legacyCategory = { ...CATEGORY, languages: [] };
  const legacyTemplate = { ...template(1), style: '' };
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ categories: [legacyCategory], templates: [legacyTemplate] })
  );
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.categories[0], 'languages'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.templates[0], 'style'), false);
});

check('missing language/length use model defaults without editing the file', () => {
  const legacyTemplate = { ...template(1) } as Record<string, unknown>;
  delete legacyTemplate.language;
  delete legacyTemplate.length;
  const parsed = parseReviewLibraryImportText(
    JSON.stringify({ categories: [CATEGORY], templates: [legacyTemplate] })
  );
  assert.equal(parsed.templates[0].language, 'English');
  assert.equal(parsed.templates[0].length, 'medium');
});

check('empty input is rejected with a clear message', () => {
  assert.throws(
    () => parseReviewLibraryImportText('   '),
    (error: unknown) =>
      error instanceof ReviewImportPayloadError && /empty/i.test(error.message)
  );
});

check('truncated JSON is rejected with a clear message', () => {
  assert.throws(
    () => parseReviewLibraryImportText('{"categories": [{"key":"real-estate"'),
    (error: unknown) =>
      error instanceof ReviewImportPayloadError && /incomplete|truncated/i.test(error.message)
  );
});

check('multiple invalid JSON values are rejected with a clear message', () => {
  assert.throws(
    () => parseReviewLibraryImportText('{"categories": []}\nnot-json'),
    (error: unknown) =>
      error instanceof ReviewImportPayloadError &&
      /more than one JSON value|one JSON value per line/i.test(error.message)
  );
});

check('unsupported root shape is rejected with a clear message', () => {
  assert.throws(
    () => parseReviewLibraryImportText('{"foo":"bar"}'),
    (error: unknown) =>
      error instanceof ReviewImportPayloadError && /Unsupported JSON shape/i.test(error.message)
  );
});

console.log(`\nRESULT: ${passed} passed, 0 failed`);
