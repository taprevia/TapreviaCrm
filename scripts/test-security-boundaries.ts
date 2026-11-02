import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { sanitizeHtml } from '@/lib/sanitizer';
import { toPublicCardDto, toPublicRenderCardDto } from '@/lib/dto/card.dto';
import { updateCardSchema } from '@/lib/validation/card';
import { updateProductConfigSchema } from '@/lib/validation/product-config';
import { isPubliclyResolvable } from '@/lib/services/card-access';
import { rateLimitFailure } from '@/lib/api';
import { buildVcf } from '@/lib/vcf';
import { resolveBackupDbName, indexCreationOptions } from '@/lib/db-target';
import { countCatalogProducts } from '@/lib/admin-product-counts';
import {
  permanentCardUrl,
  remainingCardCount,
  visibleAdminCards,
} from '@/lib/admin-card-view';
import { resolveCardDestination } from '@/lib/services/redirect-target';

const dirty = '<p>Hi</p><img src=x onerror="alert(1)"><a href="javascript:alert(2)">click</a>';
const clean = sanitizeHtml(dirty);
assert.match(clean, /<p>Hi<\/p>/);
assert.doesNotMatch(clean, /onerror|javascript:|<img/i);

const parsed = updateCardSchema.parse({
  descriptionHtml: dirty,
  privacyPolicyHtml: dirty,
  termsHtml: dirty,
});
for (const html of [parsed.descriptionHtml, parsed.privacyPolicyHtml, parsed.termsHtml]) {
  assert.ok(html);
  assert.doesNotMatch(html, /onerror|javascript:|<img/i);
}

assert.equal(
  updateProductConfigSchema.safeParse({ facebook: { profileUrl: 'javascript:alert(1)' } }).success,
  false
);
assert.equal(
  updateProductConfigSchema.safeParse({ linkedin: { resumeUrl: 'https://example.com/cv.pdf' } }).success,
  true
);

const storedCard = {
  _id: '507f1f77bcf86cd799439011',
  userId: '507f191e810c19729de860ea',
  assignedUserId: '507f191e810c19729de860eb',
  cardUid: 'NFC-PRIVATE-SERIAL',
  previousCardUids: ['OLD-PRIVATE-SERIAL'],
  name: 'Public Name',
  urlAlias: 'public-name',
  basic: { firstName: 'Public', lastName: 'Name', dateOfBirth: new Date('1990-01-01') },
  location: { address: 'Public address', mapsUrl: 'https://maps.example/', lat: 1, lng: 2 },
  reviewAssistant: {
    googleReviewUrl: 'https://example.com/review',
    employees: ['Private employee'],
    keywords: ['private keyword'],
  },
  stats: { taps: 100 },
};
const publicJson = JSON.stringify(toPublicCardDto(storedCard));
assert.doesNotMatch(publicJson, /userId|assignedUserId|NFC-PRIVATE|OLD-PRIVATE|dateOfBirth|"lat"|"lng"|"stats"/);
const renderJson = JSON.stringify(toPublicRenderCardDto(storedCard));
assert.doesNotMatch(renderJson, /userId|assignedUserId|NFC-PRIVATE|OLD-PRIVATE|dateOfBirth|Private employee|private keyword|"stats"/);
assert.match(renderJson, /Public address/);
assert.match(renderJson, /https:\/\/example\.com\/review/);

// Public visibility: legacy owner-bound unassigned stays live; suspended and
// ownerless inventory stays private; explicit isActive=false always wins.
assert.equal(isPubliclyResolvable({ isActive: true, status: 'active', userId: 'u1' }), true);
assert.equal(isPubliclyResolvable({ isActive: true, status: 'unassigned', userId: 'u1' }), true);
assert.equal(isPubliclyResolvable({ isActive: true, status: undefined, userId: 'u1' }), true);
assert.equal(isPubliclyResolvable({ isActive: true, status: undefined, userId: null }), false);
assert.equal(isPubliclyResolvable({ isActive: true, status: 'unassigned', userId: null }), false);
assert.equal(isPubliclyResolvable({ isActive: true, status: 'suspended', userId: 'u1' }), false);
assert.equal(isPubliclyResolvable({ isActive: false, status: 'active', userId: 'u1' }), false);

// CSV formula injection is neutralised without changing ordinary cells.
const csv = Papa.unparse({ fields: ['Name'], data: [['=HYPERLINK("http://x")'], ['Normal']] }, { escapeFormulae: true });
assert.match(csv, /'=HYPERLINK/);
assert.match(csv, /Normal/);

// Limiter store failures surface as 503; genuine limits remain 429.
assert.equal(rateLimitFailure({ success: true, retryAfterSec: 0 }, 'limited'), null);
assert.equal(rateLimitFailure({ success: false, retryAfterSec: 30 }, 'limited')?.status, 429);
assert.equal(rateLimitFailure({ success: false, retryAfterSec: 5, unavailable: true }, 'limited')?.status, 503);

// VCF uses a stable public identifier, never the NFC serial.
const vcf = buildVcf(
  { _id: '507f1f77bcf86cd799439011', cardUid: 'NFC-SECRET', urlAlias: '', slug: 'public-slug', name: 'A' } as never,
  'https://example.com'
);
assert.match(vcf, /UID:public-slug/);
assert.doesNotMatch(vcf, /NFC-SECRET/);

// Backup isolation: production keeps its historical name; development is
// namespaced; dev can never opt into the production backup database.
assert.equal(resolveBackupDbName('test'), 'taprevia_backup');
assert.equal(resolveBackupDbName('test', undefined, true), 'taprevia_backup');
assert.equal(resolveBackupDbName('custom_prod', undefined, true), 'taprevia_backup');
assert.equal(resolveBackupDbName('taprevia_V2'), 'taprevia_V2_backup');
assert.equal(resolveBackupDbName('taprevia_V2', 'custom_backup'), 'custom_backup');
assert.throws(() => resolveBackupDbName('taprevia_V2', 'taprevia_backup'));
assert.throws(() => resolveBackupDbName('taprevia_V2', 'taprevia_V2'));

// Admin product totals mirror the Products listing: code catalog length, with
// DB records only able to mark an entry inactive (missing record = active).
const counts = countCatalogProducts(
  ['business-nfc-card', 'google_review_standee', 'legacy_product'],
  [
    { slug: 'business-nfc-card', active: true },
    { slug: 'google-review-standee', active: false },
  ]
);
assert.deepEqual(counts, { products: 3, activeProducts: 2 });

// Admin NFC View More: 0/1/3/4/5/10 cards, order preserved.
for (const total of [0, 1, 3, 4, 5, 10]) {
  const cards = Array.from({ length: total }, (_, i) => ({ id: i }));
  const collapsed = visibleAdminCards(cards, false);
  const expanded = visibleAdminCards(cards, true);
  assert.equal(collapsed.length, Math.min(total, 4));
  assert.equal(expanded.length, total);
  assert.deepEqual(collapsed.map((c) => c.id), cards.slice(0, 4).map((c) => c.id));
  assert.equal(remainingCardCount(total), Math.max(0, total - 4));
}

// QR prefers the permanent /r/{routeSlug} route, then the existing human and
// legacy public routes; it never invents an identifier.
assert.equal(
  permanentCardUrl({ routeSlug: 'abc123' }, 'https://taprev.in'),
  'https://taprev.in/r/abc123'
);
assert.equal(permanentCardUrl({ routeSlug: '' }, 'https://taprev.in'), '');
assert.equal(permanentCardUrl({}, 'https://taprev.in'), '');
assert.equal(permanentCardUrl({ routeSlug: 'abc123' }, ''), '');
assert.equal(permanentCardUrl({ publicSlug: 'acme/premium' }, 'https://taprev.in'), 'https://taprev.in/acme/premium');
assert.equal(permanentCardUrl({ urlAlias: 'legacy-alias' }, 'https://taprev.in'), 'https://taprev.in/profile/legacy-alias');
assert.equal(permanentCardUrl({ slug: 'legacy-slug' }, 'https://taprev.in'), 'https://taprev.in/c/legacy-slug');
assert.notEqual(
  permanentCardUrl({ routeSlug: 'card-a' }, 'https://taprev.in'),
  permanentCardUrl({ routeSlug: 'card-b' }, 'https://taprev.in')
);

// Permanent-route destination matrix.
assert.equal(
  resolveCardDestination({
    kind: 'social',
    redirectUrl: 'https://example.com/dest',
    publicSlug: 'biz/social',
    urlAlias: 'alias',
  }),
  'https://example.com/dest'
);
assert.equal(
  resolveCardDestination({
    kind: 'review',
    redirectUrl: '',
    publicSlug: 'biz/google-review',
    urlAlias: 'digital-alias',
  }),
  '/review/digital-alias'
);
assert.equal(
  resolveCardDestination({
    kind: 'profile',
    publicSlug: 'biz/card',
    urlAlias: 'alias',
  }),
  '/biz/card'
);
assert.equal(
  resolveCardDestination({ kind: 'profile', publicSlug: '', urlAlias: 'alias' }),
  '/profile/alias?src=qr'
);
assert.equal(
  resolveCardDestination({ kind: 'social', urlAlias: 'alias' }),
  null
);
assert.equal(
  resolveCardDestination({ kind: 'profile', slug: 'legacy-slug' }),
  '/c/legacy-slug'
);
assert.equal(resolveCardDestination({ kind: 'review', publicSlug: 'biz/x' }), null);
// The public review resolver accepts the legacy printed slug, so interception
// fallback must match it rather than dropping a historical review card.
assert.equal(
  resolveCardDestination({ kind: 'review', slug: 'legacy-slug' }),
  '/review/legacy-slug'
);
assert.equal(resolveCardDestination({ kind: 'profile' }), null);
assert.equal(resolveCardDestination({ kind: 'future-product', publicSlug: 'biz/x' }), null);

// Production must never create indexes/collections on startup.
assert.deepEqual(indexCreationOptions(true), { autoIndex: false, autoCreate: false });
assert.deepEqual(indexCreationOptions(false), { autoIndex: true, autoCreate: true });

console.log('Security boundary tests passed.');
