/**
 * smoke-public-routes.ts — live runtime smoke tests for the public card
 * experience routing (M6). Requires a running MongoDB + built Next app.
 *
 * Usage:
 *   npm run build && npm start -- -p 3100
 *   SMOKE_BASE_URL=http://localhost:3100 npx tsx scripts/smoke-public-routes.ts
 *
 * Fixtures are upserted by cardUid so reruns are safe. Analytics assertions
 * use row-count deltas so accumulated data doesn't invalidate results.
 */

import mongoose from 'mongoose';
import Card from '../src/models/Card';
import User from '../src/models/User';
import AnalyticsLog from '../src/models/AnalyticsLog';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3100';

/* ─── Fixture definitions ─────────────────────────────────────────────────── */

const SOCIAL_DEST = 'https://example.com/smoke-dest-01';

interface Fixture {
  uid: string;
  slug: string;
  urlAlias: string;
  status: string;
  isActive: boolean;
  kind: string;
  redirectUrl?: string;
  reviewAssistant?: Record<string, unknown>;
  firstName?: string;
  lastName?: string;
}

const FIXTURES: Fixture[] = [
  {
    uid: 'SMOKE-PROFILE-01',
    slug: 'smoke-profile-01',
    urlAlias: 'smokeprofile01',
    status: 'active',
    isActive: true,
    kind: 'profile',
    firstName: 'Smoke',
    lastName: 'Profile',
  },
  {
    uid: 'SMOKE-SOCIAL-01',
    slug: 'smoke-social-01',
    urlAlias: 'smokesocial01',
    status: 'active',
    isActive: true,
    kind: 'social',
    redirectUrl: SOCIAL_DEST,
  },
  {
    uid: 'SMOKE-REVIEW-01',
    slug: 'smoke-review-01',
    urlAlias: 'smokereview01',
    status: 'active',
    isActive: true,
    kind: 'review',
    reviewAssistant: {
      enabled: true,
      googleReviewUrl: 'https://example.com/review-g-01',
      writingStyle: 'friendly',
      preferredLength: 'medium',
      languages: ['English'],
      feedbackTopics: ['service'],
      welcomeMessage: 'Tell us about your visit!',
    },
  },
  {
    uid: 'SMOKE-REVIEW-02',
    slug: 'smoke-review-02',
    urlAlias: 'smokereview02',
    status: 'active',
    isActive: true,
    kind: 'review',
    reviewAssistant: { enabled: false },
  },
  {
    uid: 'SMOKE-INACTIVE-01',
    slug: 'smoke-inactive-01',
    urlAlias: 'smokeinactive01',
    status: 'unassigned',
    isActive: false,
    kind: 'profile',
  },
];

/* ─── Result bookkeeping ──────────────────────────────────────────────────── */

let failures = 0;
let passes = 0;

function report(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

interface HttpResult {
  status: number;
  location: string;
  body: string;
  contentType: string;
  contentDisposition: string;
}

async function request(path: string, cookie?: string): Promise<HttpResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers });
  const body = await res.text().catch(() => '');
  return {
    status: res.status,
    location: res.headers.get('location') ?? '',
    body,
    contentType: res.headers.get('content-type') ?? '',
    contentDisposition: res.headers.get('content-disposition') ?? '',
  };
}

async function analyticsCount(cardId: unknown, action: string): Promise<number> {
  return AnalyticsLog.countDocuments({ cardId, action });
}

async function upsertFixtures(): Promise<MockCardIds> {
  let user = await User.findOne({ email: 'smoke.user@taprevia.com' });
  if (!user) {
    user = await User.create({
      name: 'Smoke User',
      email: 'smoke.user@taprevia.com',
      passwordHash: 'x',
      role: 'customer',
      status: 'active',
    });
  }

  const ids: MockCardIds = { profile: [], social: [], review: [] };
  for (const f of FIXTURES) {
    const doc = await Card.findOneAndUpdate(
      { cardUid: f.uid },
      {
        $set: {
          cardUid: f.uid,
          slug: f.slug,
          routeSlug: f.slug,
          urlAlias: f.urlAlias,
          status: f.status,
          isActive: f.isActive,
          kind: f.kind,
          redirectUrl: f.redirectUrl ?? '',
          reviewAssistant: f.reviewAssistant ?? { enabled: false },
          assignedUserId: user._id,
          userId: user._id,
          name: f.firstName ? `${f.firstName} ${f.lastName}` : f.urlAlias,
          basic: {
            firstName: f.firstName ?? '',
            lastName: f.lastName ?? '',
            email: '',
            alternateEmail: '',
            phone: '',
            alternatePhone: '',
            company: 'Smoke Co',
            jobTitle: 'Smoke Tester',
            defaultLanguage: 'en',
          },
        },
      },
      { upsert: true, new: true }
    );
    ids[f.kind as keyof MockCardIds]?.push({
      _id: doc._id,
      uid: f.uid,
      urlAlias: f.urlAlias,
      slug: f.slug,
    });
  }
  return ids;
}

interface MockCardIds {
  profile?: Array<{ _id: unknown; uid: string; urlAlias: string; slug: string }>;
  social?: Array<{ _id: unknown; uid: string; urlAlias: string; slug: string }>;
  review?: Array<{ _id: unknown; uid: string; urlAlias: string; slug: string }>;
}

/* ─── Tests ───────────────────────────────────────────────────────────────── */

async function run() {
  console.log(`Connecting to ${MONGODB_URI} …`);
  await mongoose.connect(MONGODB_URI);
  const ids = await upsertFixtures();
  console.log('Fixtures ready.');

  const social = ids.social?.[0];
  const inactive = ids.profile?.[1];

  /* 1. Profile card renders through its public entry path */
  const profilePage = await request('/profile/smokeprofile01');
  report('profile /profile renders 200', profilePage.status === 200, `status=${profilePage.status}`);
  report('profile /profile renders person name', profilePage.body.includes('Smoke'), 'no name in body');

  /* 2. Social direct hit → 307 + exactly one social_redirect */
  const socialBefore = await analyticsCount(social?._id, 'social_redirect');
  const socialDirect = await request('/profile/smokesocial01');
  const socialAfter = await analyticsCount(social?._id, 'social_redirect');
  report('social /profile → 307', socialDirect.status === 307, `status=${socialDirect.status}`);
  report('social /profile → external dest', socialDirect.location === SOCIAL_DEST, socialDirect.location);
  report('social /profile → 1 social_redirect row', socialAfter - socialBefore === 1, `delta=${socialAfter - socialBefore}`);

  /* 3. Social via slug shim converges + one event per hit */
  const cShim = await request('/c/smoke-social-01');
  report('social /c → 307', cShim.status === 307, `status=${cShim.status}`);
  report('social /c → /profile location', cShim.location.includes('/profile/smokesocial01'), cShim.location);
  const socialBeforeC = await analyticsCount(social?._id, 'social_redirect');
  const viaC = await request(cShim.location || '/profile/smokesocial01');
  const socialAfterC = await analyticsCount(social?._id, 'social_redirect');
  report('social chain (/c) → 307 external', viaC.status === 307, `status=${viaC.status}`);
  report('social chain (/c) → exactly 1 social_redirect', socialAfterC - socialBeforeC === 1, `delta=${socialAfterC - socialBeforeC}`);

  /* 4. Social NFC /t → tap logged + redirect, chain yields one social_redirect */
  const tapBefore = await analyticsCount(social?._id, 'tap');
  const nfc = await request('/t/SMOKE-SOCIAL-01');
  const tapAfter = await analyticsCount(social?._id, 'tap');
  report('social /t → 302', nfc.status === 302, `status=${nfc.status}`);
  report('social /t → /profile location', nfc.location.includes('/profile/smokesocial01') && nfc.location.includes('src=nfc'), nfc.location);
  report('social /t → exactly 1 tap row', tapAfter - tapBefore === 1, `delta=${tapAfter - tapBefore}`);
  const socialBeforeT = await analyticsCount(social?._id, 'social_redirect');
  const viaT = await request(nfc.location.replace(BASE, '') || '/profile/smokesocial01');
  const socialAfterT = await analyticsCount(social?._id, 'social_redirect');
  report('social chain (/t) → 307 external', viaT.status === 307, `status=${viaT.status}`);
  report('social chain (/t) → exactly 1 social_redirect', socialAfterT - socialBeforeT === 1, `delta=${socialAfterT - socialBeforeT}`);

  /* 5. Review enabled → flow reachable; /profile dispatch forwards */
  const reviewPage = await request('/review/smokereview01');
  report('review(on) /review → 200', reviewPage.status === 200, `status=${reviewPage.status}`);
  report('review(on) /review → has content', reviewPage.body.length > 200, `len=${reviewPage.body.length}`);
  const reviewDispatch = await request('/profile/smokereview01');
  report('review(on) /profile → 307', reviewDispatch.status === 307, `status=${reviewDispatch.status}`);
  report('review(on) /profile → /review location', reviewDispatch.location.includes('/review/smokereview01'), reviewDispatch.location);

  /* 6. Review disabled → fails safely, non-informative at /profile */
  const reviewDisabled = await request('/review/smokereview02');
  report('review(off) /review → 200 unavailable', reviewDisabled.status === 200, `status=${reviewDisabled.status}`);
  report('review(off) /review → unavailable copy', reviewDisabled.body.includes('available'), 'missing copy');
  const reviewOffDispatch = await request('/profile/smokereview02');
  report('review(off) /profile → 404', reviewOffDispatch.status === 404, `status=${reviewOffDispatch.status}`);

  /* 7. Inactive cards expose nothing */
  const inactiveProfile = await request('/profile/smokeinactive01');
  report('inactive /profile → 404', inactiveProfile.status === 404, `status=${inactiveProfile.status}`);
  const inactiveSlug = await request('/c/smoke-inactive-01');
  report('inactive /c (slug) → 404', inactiveSlug.status === 404, `status=${inactiveSlug.status}`);
  const inactiveUid = await request('/c/SMOKE-INACTIVE-01');
  report('inactive /c (cardUid) → 404 (no alias leak)', inactiveUid.status === 404, `status=${inactiveUid.status} loc=${inactiveUid.location}`);
  const inactiveTapBefore = await analyticsCount(inactive?._id, 'tap');
  const inactiveNfc = await request('/t/SMOKE-INACTIVE-01');
  const inactiveTapAfter = await analyticsCount(inactive?._id, 'tap');
  report('inactive /t → 302 home (non-informative)', inactiveNfc.status === 302 && !inactiveNfc.location.includes('/profile'), `status=${inactiveNfc.status} loc=${inactiveNfc.location}`);
  report('inactive /t → no tap logged', inactiveTapAfter - inactiveTapBefore === 0, `delta=${inactiveTapAfter - inactiveTapBefore}`);

  /* 8. Middleware cannot block printed QR paths (stale/invalid token) */
  const badToken = 'token=definitely-not-a-real-jwt';
  const qrBadToken = await request('/qr/unknown-qr-123', badToken);
  report('middleware: /qr unknown with bad token → not login redirect', qrBadToken.status !== 302 || !qrBadToken.location.includes('/login'), `status=${qrBadToken.status} loc=${qrBadToken.location}`);
  report('middleware: /qr unknown → 404 from route', qrBadToken.status === 404, `status=${qrBadToken.status}`);
  const profileBadToken = await request('/profile/smokeprofile01', badToken);
  report('middleware: /profile with bad token still 200 (allowlist)', profileBadToken.status === 200, `status=${profileBadToken.status}`);

  /* 9. Data API does not expose redirect-only product profile data */
  const apiProfile = await request('/api/public/cards/smokeprofile01');
  let apiProfileKind = '';
  try {
    apiProfileKind = JSON.parse(apiProfile.body).card?.kind ?? '';
  } catch {
    /* keep '' */
  }
  report('data API profile → 200 + kind=profile', apiProfile.status === 200 && apiProfileKind === 'profile', `status=${apiProfile.status} kind=${apiProfileKind}`);
  const apiSocial = await request('/api/public/cards/smokesocial01');
  report('data API social → 404 (no exposure)', apiSocial.status === 404, `status=${apiSocial.status}`);
  const apiReview = await request('/api/public/cards/smokereview01');
  report('data API review → 404 (no exposure)', apiReview.status === 404, `status=${apiReview.status}`);
  const apiInactive = await request('/api/public/cards/smokeinactive01');
  report('data API inactive → 404', apiInactive.status === 404, `status=${apiInactive.status}`);
  const vcfSocial = await request('/api/public/cards/smokesocial01/vcf');
  report('vcf social → 404 (no exposure)', vcfSocial.status === 404, `status=${vcfSocial.status}`);
  const vcfProfile = await request('/api/public/cards/smokeprofile01/vcf');
  report('vcf profile → 200 vcard', vcfProfile.status === 200 && vcfProfile.body.includes('BEGIN:VCARD'), `status=${vcfProfile.status}`);
  report(
    'vcf profile → RFC 2426 headers',
    vcfProfile.contentType.toLowerCase().includes('text/vcard') &&
      vcfProfile.contentType.toLowerCase().includes('charset=utf-8'),
    `content-type=${vcfProfile.contentType}`,
  );
  report(
    'vcf profile → attachment filename',
    /^attachment; filename="[^"]+\.vcf"/.test(vcfProfile.contentDisposition),
    `content-disposition=${vcfProfile.contentDisposition}`,
  );
  report(
    'vcf profile → CRLF line endings only',
    vcfProfile.body.includes('VERSION:3.0\r\n') && !/(^|[^\r])\n/.test(vcfProfile.body),
  );
  report(
    'vcf profile → N is a 5-component structured value',
    /^N;CHARSET=UTF-8:[^;]*;[^;]*;;;$/m.test(vcfProfile.body.replace(/\r\n /g, '')),
    `body=${vcfProfile.body.slice(0, 120).replace(/\r\n/g, '\\n')}`,
  );
  report(
    'vcf profile → no line exceeds 75 octets',
    vcfProfile.body.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75),
  );
  report('vcf profile → closes the record', vcfProfile.body.trimEnd().endsWith('END:VCARD'));

  await mongoose.disconnect();

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Smoke run crashed:', error);
  process.exit(2);
});