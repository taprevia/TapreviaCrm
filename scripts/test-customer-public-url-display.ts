/**
 * Customer Public URL display test.
 *
 * Rule: customers display/copy/share the immutable PUBLIC URL. NFC/QR payloads
 * keep the permanent /r/{routeSlug} route (PPL-01). Both are intentionally
 * different and must never be substituted for one another.
 *
 * Pure + static coverage (no database, no writes).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  resolveCustomerPublicPath,
  resolveCustomerPublicUrl,
  resolveCustomerStandeePath,
  resolveCustomerStandeeUrl,
} from '@/lib/services/customer-public-url';

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

const root = process.cwd();
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const BASE = 'https://www.taprevia.com';

/* ── 1. Product-specific Public URL resolution ─────────────────────────── */

check('profile card uses immutable publicSlug', () => {
  assert.equal(
    resolveCustomerPublicPath({ kind: 'profile', publicSlug: 'acme/premium-card', urlAlias: 'acme-alias' }),
    '/acme/premium-card'
  );
});

check('profile card without publicSlug uses legacy profile alias', () => {
  assert.equal(
    resolveCustomerPublicPath({ kind: 'profile', urlAlias: 'legacy-alias' }),
    '/profile/legacy-alias'
  );
});

check('review card prefers immutable publicSlug when allocated', () => {
  assert.equal(
    resolveCustomerPublicPath({
      kind: 'review',
      publicSlug: 'acme/google-review',
      urlAlias: 'review-alias',
    }),
    '/acme/google-review'
  );
});

check('review card without publicSlug uses /review/{urlAlias}', () => {
  assert.equal(
    resolveCustomerPublicPath({ kind: 'review', urlAlias: 'review-alias' }),
    '/review/review-alias'
  );
});

check('review card falls back to immutable slug when alias and publicSlug are absent', () => {
  assert.equal(
    resolveCustomerPublicPath({ kind: 'review', slug: 'legacy-review' }),
    '/review/legacy-review'
  );
});

check('social card displays the Taprevia public route, never the external URL', () => {
  const pathValue = resolveCustomerPublicPath({
    kind: 'social',
    publicSlug: 'acme/instagram',
    urlAlias: 'social-alias',
  });
  assert.equal(pathValue, '/acme/instagram');
  assert.doesNotMatch(pathValue ?? '', /instagram\.com/);
});

check('social card without publicSlug uses stable profile route, not external', () => {
  assert.equal(
    resolveCustomerPublicPath({ kind: 'social', urlAlias: 'social-alias' }),
    '/profile/social-alias'
  );
});

check('legacy slug-only card uses the public /c shim', () => {
  assert.equal(resolveCustomerPublicPath({ slug: 'legacy-slug' }), '/c/legacy-slug');
});

check('card with no stable identifier returns null (unavailable state)', () => {
  assert.equal(resolveCustomerPublicPath({ kind: 'profile' }), null);
});

check('absolute public URL uses the trusted configured base', () => {
  assert.equal(
    resolveCustomerPublicUrl({ kind: 'profile', publicSlug: 'acme/card' }, BASE),
    `${BASE}/acme/card`
  );
  assert.equal(resolveCustomerPublicUrl({ kind: 'profile', publicSlug: 'acme/card' }, ''), null);
});

check('standee public URL uses the allocated publicSlug', () => {
  assert.equal(resolveCustomerStandeePath({ publicSlug: 'acme/standee-4' }), '/acme/standee-4');
  assert.equal(resolveCustomerStandeeUrl({ publicSlug: 'acme/standee-4' }, BASE), `${BASE}/acme/standee-4`);
});

check('standee without publicSlug is unavailable, not /r', () => {
  assert.equal(resolveCustomerStandeePath({ publicSlug: null }), null);
});

/* ── 2. Display / copy / share wiring ──────────────────────────────────── */

const vcards = read('src/app/(dashboard)/dashboard/vcards/page-client.tsx');
check('vCards display and QR modal show Public URL', () => {
  assert.match(vcards, /resolveCardDisplayUrl\(vcard, origin\)/);
  assert.match(vcards, /resolveCardDisplayUrl\(qrTarget, origin\)/);
  assert.match(vcards, /Public URL unavailable/);
});
check('vCards QR payload still uses the permanent route helper', () => {
  assert.match(vcards, /resolveCardQrUrl\(vcard, origin\)/);
  assert.match(vcards, /resolveCardQrUrl\(qrTarget, origin\)/);
});

const productsList = read('src/app/(dashboard)/dashboard/products/page.tsx');
const productsDetail = read('src/app/(dashboard)/dashboard/products/[id]/page.tsx');
check('My Products list displays and copies the Public URL', () => {
  assert.match(productsList, /resolveCustomerPublicPath/);
  assert.match(productsList, /copy\(publicUrlFull/);
  assert.match(productsList, /\{publicUrlFull\}/);
});
check('Product detail displays and copies the Public URL', () => {
  assert.match(productsDetail, /resolveCustomerPublicPath/);
  assert.match(productsDetail, /copyPublicUrl/);
  assert.match(productsDetail, /writeText\(publicUrlFull\)/);
});
check('Dashboard product pages do not build customer URLs from window origin', () => {
  assert.doesNotMatch(productsList, /window\.location\.origin/);
  assert.doesNotMatch(productsDetail, /window\.location\.origin/);
});

const standee = read('src/components/dashboard/standee-manager.tsx');
check('Standee manager displays/copies the publicSlug panel URL', () => {
  assert.match(standee, /row\.publicUrl/);
  assert.match(standee, /Public URL unavailable/);
  assert.doesNotMatch(standee, /row\.preview\?\.ok \? row\.preview\.href/);
});

const sticky = read('src/components/public/sticky-dock.tsx');
check('Public Share/Copy uses the Public URL, not /profile/{alias}', () => {
  assert.match(sticky, /resolveCustomerPublicUrl\(vcard, canonicalPublicBase\(\)\)/);
  assert.match(sticky, /const url = shareUrl/);
  assert.doesNotMatch(sticky, /window\.location\.origin/);
  assert.doesNotMatch(sticky, /\/profile\/\$\{vcard\.urlAlias\}/);
});
check('Public Share is disabled when no Public URL exists', () => {
  assert.match(sticky, /disabled=\{!shareUrl\}/);
});

const professional = read('src/components/public/templates/professional-profile.tsx');
const panthi = read('src/components/public/templates/panthi-event.tsx');
check('Profile templates copy the Public URL', () => {
  assert.match(professional, /resolveCustomerPublicPath\(vcard\)/);
  assert.match(panthi, /resolveCustomerPublicPath\(vcard\)/);
  assert.doesNotMatch(professional, /\/profile\/\$\{vcard\.urlAlias/);
  assert.doesNotMatch(panthi, /\/profile\/\$\{vcard\.urlAlias/);
});

const basicTab = read('src/components/builder/tabs/basic-tab.tsx');
check('Builder shows the product-specific Public URL read-only', () => {
  assert.match(basicTab, /resolveCustomerPublicPath\(draft\)/);
  assert.match(basicTab, /Public URL/);
  assert.match(basicTab, /readOnly/);
  assert.match(basicTab, /writeText\(publicUrl\)/);
  assert.doesNotMatch(basicTab, /\/profile\/\$\{alias\}/);
});

const builderShell = read('src/components/builder/builder-shell.tsx');
check('Builder header uses the Public URL resolver', () => {
  assert.match(builderShell, /resolveCustomerPublicPath\(draft\)/);
});

const overview = read('src/components/dashboard/overview/vcard-strip.tsx');
const subscriberUi = read('src/app/(dashboard)/dashboard/subscribers/page-client.tsx');
const subscriberApi = read('src/app/api/newsletter-subscribers/route.ts');
check('Overview tile displays the Public URL', () => {
  assert.match(overview, /resolveCustomerPublicPath\(vcard\)/);
});
check('Subscribers row displays the Public URL', () => {
  assert.match(subscriberUi, /resolveCustomerPublicPath\(subscriber\.card\)/);
  assert.match(subscriberApi, /publicSlug/);
});

const vcf = read('src/lib/vcf.ts');
const vcfRoute = read('src/app/api/public/cards/[alias]/vcf/route.ts');
check('vCard download URL uses the Public URL and trusted base', () => {
  assert.match(vcf, /resolveCustomerPublicPath/);
  assert.match(vcf, /publicSlug: card\.publicSlug/);
  assert.match(vcfRoute, /canonicalPublicBase\(\) \|\| request\.nextUrl\.origin/);
});

/* ── 3. Separation invariants ──────────────────────────────────────────── */

check('Public URL helper never emits the permanent /r route', () => {
  const src = read('src/lib/services/customer-public-url.ts');
  assert.doesNotMatch(src, /return\s+`\/r\//);
  assert.doesNotMatch(src, /`\/r\/\$\{/);
});
check('QR payload helper still prefers routeSlug over public paths', () => {
  const src = read('src/lib/admin-card-view.ts');
  assert.match(src, /if \(routeSlug\) return `\/r\/\$\{routeSlug\}`/);
});
check('No customer dashboard/component constructs /profile links from window origin', () => {
  for (const file of [
    'src/app/(dashboard)/dashboard/vcards/page-client.tsx',
    'src/app/(dashboard)/dashboard/products/page.tsx',
    'src/app/(dashboard)/dashboard/products/[id]/page.tsx',
    'src/components/dashboard/standee-manager.tsx',
    'src/components/public/sticky-dock.tsx',
  ]) {
    assert.doesNotMatch(read(file), /window\.location\.origin/, file);
  }
});

console.log(`\nCustomer Public URL display: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
