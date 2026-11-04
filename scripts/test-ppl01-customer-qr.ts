/**
 * PPL-01 regression test — customer vCards QR payload.
 *
 * The customer QR must encode a stable redirect identity only:
 *   1. /r/{routeSlug}   (permanent NFC/QR route)
 *   2. /{publicSlug}    (allocated-once, immutable legacy public path)
 *
 * It must never encode:
 *   - preview.href (canonical preview can be an external destination)
 *   - editable urlAlias (/profile/{alias})
 *   - an external social/review destination
 *   - a URL built from window.location / request Host
 *
 * Pure test: no database, no server, no writes.
 * Run: npx tsx scripts/test-ppl01-customer-qr.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { permanentCardUrl } from '../src/lib/admin-card-view';

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
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL ${name} — ${message}`);
  }
}

const BASE = 'https://www.taprevia.com';

/* ── 1. Stable helper contract ─────────────────────────────────────────── */

check('routeSlug wins: /r/{routeSlug}', () => {
  assert.equal(
    permanentCardUrl({ routeSlug: 'mvz27ltnip', publicSlug: 'kaka-pvc/google-review' }, BASE),
    `${BASE}/r/mvz27ltnip`
  );
});

check('legacy publicSlug is used when routeSlug is absent', () => {
  assert.equal(
    permanentCardUrl({ publicSlug: 'kaka-pvc/instagram' }, BASE),
    `${BASE}/kaka-pvc/instagram`
  );
});

check('no stable identifier returns empty (explicit unavailable state)', () => {
  assert.equal(permanentCardUrl({}, BASE), '');
});

check('missing trusted base returns empty', () => {
  assert.equal(permanentCardUrl({ routeSlug: 'route-a' }, ''), '');
});

check('trailing slashes on the base never duplicate', () => {
  assert.equal(
    permanentCardUrl({ routeSlug: 'route-a' }, 'https://www.taprevia.com///'),
    'https://www.taprevia.com/r/route-a'
  );
});

/* ── 2. Product-kind matrix (kind/destination/alias must not leak) ─────── */

const products = {
  'Premium NFC Business Card': {
    kind: 'profile',
    routeSlug: 'route-premium',
    publicSlug: 'acme/premium-card',
    urlAlias: 'editable-alias',
  },
  'Google Review NFC Card': {
    kind: 'review',
    routeSlug: 'route-review',
    publicSlug: 'acme/google-review',
    urlAlias: 'editable-review-alias',
  },
  'Google Review NFC Plate': {
    kind: 'review',
    routeSlug: 'route-plate',
    publicSlug: 'acme/google-review-2',
    urlAlias: 'editable-plate-alias',
  },
  'Social NFC Card': {
    kind: 'social',
    routeSlug: 'route-social',
    publicSlug: 'acme/instagram',
    urlAlias: 'editable-social-alias',
    redirectUrl: 'https://instagram.com/',
  },
} as const;

for (const [label, card] of Object.entries(products)) {
  check(`${label}: QR is /r/{routeSlug}, not alias or destination`, () => {
    // Mirror the page's stable projection exactly (no urlAlias, no redirectUrl).
    const url = permanentCardUrl(
      { routeSlug: card.routeSlug, publicSlug: card.publicSlug },
      BASE
    );
    assert.equal(url, `${BASE}/r/${card.routeSlug}`);
    assert.ok(!url.includes('editable-'));
    assert.ok(!url.includes('instagram.com'));
  });
}

check('legacy card with publicSlug only uses immutable public path', () => {
  const url = permanentCardUrl({ publicSlug: 'legacy/instagram' }, BASE);
  assert.equal(url, `${BASE}/legacy/instagram`);
});

check('alias-only card is unavailable, not /profile/{alias}', () => {
  assert.equal(permanentCardUrl({ routeSlug: '', publicSlug: '' }, BASE), '');
});

/* ── 3. Source wiring checks ───────────────────────────────────────────── */

const root = process.cwd();
const pagePath = path.join(
  root,
  'src/app/(dashboard)/dashboard/vcards/page-client.tsx'
);
const source = readFileSync(pagePath, 'utf8');

check('vCards imports the existing permanent URL helper', () => {
  assert.match(source, /import\s+\{\s*permanentCardUrl\s*\}\s+from\s+'@\/lib\/admin-card-view'/);
});

check('QR helper passes only routeSlug/publicSlug to permanentCardUrl', () => {
  const fn = /function resolveCardQrUrl\([\s\S]*?\n\}/.exec(source)?.[0] ?? '';
  assert.ok(fn, 'resolveCardQrUrl not found');
  assert.match(fn, /routeSlug:\s*vcard\.routeSlug/);
  assert.match(fn, /publicSlug:\s*vcard\.publicSlug/);
  assert.doesNotMatch(fn, /urlAlias/);
  assert.doesNotMatch(fn, /preview/);
  assert.doesNotMatch(fn, /redirectUrl/);
});

check('QR image, QR download and displayed payload share resolveCardQrUrl', () => {
  const openQr = /const openQr = async[\s\S]*?\n  \};/.exec(source)?.[0] ?? '';
  const downloadQr = /const downloadQr = async[\s\S]*?\n  \};/.exec(source)?.[0] ?? '';
  assert.match(openQr, /resolveCardQrUrl\(vcard, origin\)/);
  assert.match(downloadQr, /resolveCardQrUrl\(qrTarget, origin\)/);
  assert.ok(source.includes("qrTarget ? resolveCardQrUrl(qrTarget, origin) : ''"));
});

check('QR paths never build from window.location / request origin', () => {
  assert.doesNotMatch(source, /window\.location\.origin/);
});

check('canonical preview is still used only for display/preview, never QR', () => {
  const displayFn = /function resolveCardPublicUrl\([\s\S]*?\n\}/.exec(source)?.[0] ?? '';
  assert.match(displayFn, /preview\.href/);
  const qrFn = /function resolveCardQrUrl\([\s\S]*?\n\}/.exec(source)?.[0] ?? '';
  assert.doesNotMatch(qrFn, /preview\.href/);
  const openQr = /const openQr = async[\s\S]*?\n  \};/.exec(source)?.[0] ?? '';
  const downloadQr = /const downloadQr = async[\s\S]*?\n  \};/.exec(source)?.[0] ?? '';
  assert.doesNotMatch(openQr, /preview\.href/);
  assert.doesNotMatch(downloadQr, /preview\.href/);
});

check('public preview action is unchanged (still uses preview.href)', () => {
  assert.match(source, /vcard\.preview && vcard\.preview\.ok \? vcard\.preview\.href : ''/);
});

check('QR button remains available for every card', () => {
  assert.match(source, /onClick=\{\(\) => openQr\(vcard\)\}/);
});

console.log(`\nPPL-01 QR regression: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
