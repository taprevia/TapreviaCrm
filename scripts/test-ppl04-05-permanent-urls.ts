/**
 * PPL-04 / PPL-05 regression — Permanent is `/r` only; legacy is separate.
 *
 * Pure + static coverage:
 *   - strict permanent resolver never falls back to Public/Legacy.
 *   - legacy resolver preserves `/c`, `/profile`, `/qr` and encodes spaces.
 *   - Admin QR image/PDF share one payload helper.
 *   - Admin UI labels legacy routes as Legacy, never Permanent.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  legacyCardPath,
  legacyCardUrl,
  strictPermanentCardPath,
  strictPermanentCardUrl,
} from '@/lib/admin-card-view';
import {
  permanentEntryPath,
  legacyEntryPath,
} from '@/lib/services/product-preview';

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
const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

/* ── Strict Permanent ─────────────────────────────────────────────────── */

check('routeSlug is the preferred permanent /r identifier', () => {
  assert.equal(
    strictPermanentCardPath({ routeSlug: 'route-abc', uid: 'uid-abc' }),
    '/r/route-abc'
  );
  assert.equal(
    strictPermanentCardUrl({ routeSlug: 'route-abc' }, BASE),
    `${BASE}/r/route-abc`
  );
});

check('verified uid is accepted as a permanent /r identifier', () => {
  assert.equal(strictPermanentCardPath({ uid: 'uid-abc' }), '/r/uid-abc');
});

check('strict permanent never falls back to publicSlug/alias/slug', () => {
  assert.equal(
    strictPermanentCardPath({
      publicSlug: 'acme/premium-card',
      urlAlias: 'acme-alias',
      slug: 'legacy-slug',
    }),
    null
  );
  assert.equal(
    strictPermanentCardUrl({ publicSlug: 'acme/premium-card' }, BASE),
    null
  );
});

check('strict permanent returns null without trusted base', () => {
  assert.equal(strictPermanentCardUrl({ routeSlug: 'route-a' }, ''), null);
});

/* ── Legacy (explicitly labelled) ─────────────────────────────────────── */

check('legacy card path uses /c and encodes spaces', () => {
  assert.equal(legacyCardPath({ slug: 'panthi events' }), '/c/panthi%20events');
  assert.equal(
    legacyCardUrl({ slug: 'panthi events' }, BASE),
    `${BASE}/c/panthi%20events`
  );
});

check('legacy card falls back to /profile alias when slug is absent', () => {
  assert.equal(legacyCardPath({ urlAlias: 'legacy-alias' }), '/profile/legacy-alias');
});

check('legacy card never uses /r or publicSlug', () => {
  assert.equal(legacyCardPath({ routeSlug: 'route-a', publicSlug: 'acme/card', slug: 's' }), '/c/s');
  assert.doesNotMatch(legacyCardPath({ slug: 's' }) ?? '', /^\/r\//);
});

/* ── product-preview permanent/legacy split ───────────────────────────── */

check('permanentEntryPath is strict /r only', () => {
  assert.equal(permanentEntryPath('card', { routeSlug: 'route-a' }), '/r/route-a');
  assert.equal(permanentEntryPath('card', { uid: 'uid-a' }), '/r/uid-a');
  assert.equal(permanentEntryPath('card', { slug: 'legacy-slug' }), null);
  assert.equal(permanentEntryPath('standee', { routeSlug: 'standee-a' }), '/r/standee-a');
  assert.equal(permanentEntryPath('standee', { panelQr: { qrId: 'panel-a' } }), null);
});

check('legacyEntryPath preserves legacy routes separately', () => {
  assert.equal(legacyEntryPath('card', { slug: 'panthi events' }), '/c/panthi%20events');
  assert.equal(legacyEntryPath('card', { urlAlias: 'legacy-alias' }), '/profile/legacy-alias');
  assert.equal(legacyEntryPath('standee', { panelQr: { qrId: 'panel-a' } }), '/qr/panel-a');
});

/* ── Admin wiring ─────────────────────────────────────────────────────── */

const admin = read('src/app/(admin)/admin/users/[id]/page.tsx');
check('admin imports strict permanent + legacy helpers, not fallback helper', () => {
  assert.match(admin, /strictPermanentCardUrl/);
  assert.match(admin, /legacyCardUrl/);
  assert.doesNotMatch(admin, /\bpermanentCardUrl\b/);
});

check('admin QR image and PDF share one payload helper', () => {
  const occurrences = admin.match(/const url = cardQrPayload\(c, publicBaseUrl\);/g) ?? [];
  assert.equal(occurrences.length, 2, `expected 2 shared payload calls, got ${occurrences.length}`);
});

check('admin labels legacy QR explicitly', () => {
  assert.match(admin, /Legacy QR/);
  assert.match(admin, /Not the permanent \/r URL/);
});

check('admin labels legacy URL separately from Permanent', () => {
  assert.match(admin, /URL unavailable — legacy card/);
  assert.match(admin, />Legacy URL</);
  assert.match(admin, /URL unavailable — legacy standee/);
});

check('admin standee /qr fallback is labelled Legacy QR', () => {
  assert.match(admin, /!standee\.permanentEntryUrl/);
  assert.match(admin, /Legacy QR/);
});

/* ── Separation invariants ────────────────────────────────────────────── */

check('strict permanent helper has no publicSlug/urlAlias/slug fallback', () => {
  const src = read('src/lib/admin-card-view.ts');
  const fn = /export function strictPermanentCardPath[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  assert.ok(fn);
  assert.doesNotMatch(fn, /publicSlug|urlAlias|slug/);
});

check('legacy helper encodes path segments', () => {
  const src = read('src/lib/admin-card-view.ts');
  const fn = /export function legacyCardPath[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  assert.ok(fn);
  assert.match(fn, /encodeURIComponent\(slug\)/);
  assert.match(fn, /encodeURIComponent\(alias\)/);
});

console.log(`\nPPL-04/05 Permanent URL separation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
