/**
 * M10 HTTP evidence: real-endpoint acceptance checks against a running server.
 *
 * Proves the API/URL layer enforces the four experiences independently of the
 * DB harness, in particular the fixed M9 leak:
 *   - Review-only customer: /profile/[profile-card] is 404 (no profile access
 *     even though they own a profile card), /profile/[review-card] 307 → /review,
 *     /review/[review-card] works, /api/standees 403.
 *   - Social max: 2 links accepted, a 3rd rejected ("Maximum 2").
 *   - Standee-only: /api/standees 200 and shared links PUT works without the
 *     card social cap.
 *   - Profile-only: features mirror profile+social(4); review editing 403.
 *
 * Prereqs: server on SMOKE_BASE_URL, MongoDB on :27017/nfc-crm, and the M10
 * DB-harness fixtures (scripts/verify-m10-feature-access.ts) seeded first —
 * this script only sets a known password on those fixture accounts.
 *
 * Run:  SMOKE_BASE_URL=http://localhost:3000 npx tsx scripts/verify-m10-http.ts
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '@/models/User';

const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const PASSWORD = 'M10pass123!';

const USERS = {
  review: { email: 'm10-review@example.com', password: PASSWORD },
  social: { email: 'm10-social@example.com', password: PASSWORD },
  standee: { email: 'm10-standee@example.com', password: PASSWORD },
  profile: { email: 'm10-profile@example.com', password: PASSWORD },
} as const;

let passed = 0;
let failed = 0;

function report(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function seedPasswords() {
  mongoose.set('strictQuery', false);
  await mongoose.connect(MONGODB_URI);
  const hash = await bcrypt.hash(PASSWORD, 12);
  for (const { email } of Object.values(USERS)) {
    await User.updateOne({ email }, { $set: { passwordHash: hash } });
  }
  const cardIds: Record<string, unknown> = {};
  for (const uid of ['M10-SOCIAL-CARD', 'M10-PROFILE-PROD-CARD']) {
    const doc = await mongoose.connection.db!.collection('cards').findOne({ cardUid: uid });
    if (doc) cardIds[uid] = doc._id;
  }
  await mongoose.disconnect();
  return { cardIds };
}

type Cred = (typeof USERS)[keyof typeof USERS];

async function login({ email, password }: Cred): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!res.ok || !setCookie) throw new Error(`login failed for ${email} (${res.status})`);
  return setCookie.split(';')[0];
}

async function get(cookie: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: { Cookie: cookie },
  });
  const body = await res.text().catch(() => '');
  return { status: res.status, location: res.headers.get('location') ?? '', body };
}

async function put(cookie: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data };
}

async function patch(cookie: string, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, body: data };
}

const LINK = (platform: string) => ({ platform, url: `https://example.com/${platform}-${Math.random().toString(36).slice(2, 8)}` });

async function run() {
  const { cardIds } = await seedPasswords();

  const reviewCookie = await login(USERS.review);
  const socialCookie = await login(USERS.social);
  const standeeCookie = await login(USERS.standee);
  const profileCookie = await login(USERS.profile);

  /* A. Review-only customer — the central fix, at the URL level. */
  const profileDenied = await get(reviewCookie, '/profile/m10profile');
  report(
    'A /profile/[owned profile card] → 404 for review-only customer',
    profileDenied.status === 404,
    `status=${profileDenied.status}`
  );

  const reviewDispatch = await get(reviewCookie, '/profile/m10review');
  report(
    'A2 /profile/[review card] → 307 to /review',
    reviewDispatch.status === 307 && reviewDispatch.location.includes('/review/m10review'),
    `status=${reviewDispatch.status} loc=${reviewDispatch.location}`
  );

  const reviewPage = await get(reviewCookie, '/review/m10review');
  report(
    'A3 /review/[review card] works for the review owner (200)',
    reviewPage.status === 200 && reviewPage.body.length > 200,
    `status=${reviewPage.status} len=${reviewPage.body.length}`
  );

  const standeesForReview = await get(reviewCookie, '/api/standees');
  report('A4 /api/standees → 403 for review-only customer', standeesForReview.status === 403, `status=${standeesForReview.status}`);

  const reviewFeatures = await get(reviewCookie, '/api/my/features');
  let rf: Record<string, { enabled?: boolean; max?: number }> = {};
  try {
    rf = JSON.parse(reviewFeatures.body)?.features ?? {};
  } catch {
    /* keep {} */
  }
  report(
    'A5 /api/my/features: review only (no profile/social/standee)',
    reviewFeatures.status === 200 &&
      rf.review?.enabled === true &&
      rf.profile?.enabled === false &&
      rf.social?.enabled === false &&
      rf.standee?.enabled === false,
    JSON.stringify(rf)
  );

  /* B. Social product — the card social-links limit is enforced. */
  const socialCardId = String(cardIds['M10-SOCIAL-CARD'] ?? '');
  const twoLinks = await patch(socialCookie, `/api/cards/${socialCardId}`, {
    socialLinks: [LINK('instagram'), LINK('facebook')],
  });
  report('B 2 card social links → 200 (within social limit 2)', twoLinks.status === 200, String(twoLinks.status));

  const threeLinks = await patch(socialCookie, `/api/cards/${socialCardId}`, {
    socialLinks: [LINK('instagram'), LINK('facebook'), LINK('x')],
  });
  const rejected = threeLinks.status === 400 && /Maximum 2 social links/.test(threeLinks.body?.error ?? '');
  report('B2 3 card social links → 400 (server rejects > limit)', rejected, `${threeLinks.status} ${threeLinks.body?.error ?? ''}`);

  /* C. Standee-only customer — standees + shared links work without card cap. */
  const standees = await get(standeeCookie, '/api/standees');
  report('C /api/standees → 200 for standee-only customer', standees.status === 200, String(standees.status));

  const manyShared = await put(standeeCookie, '/api/profile/social-links', {
    socialLinks: ['instagram', 'facebook', 'x', 'whatsapp', 'linkedin', 'google_review'].map(LINK),
  });
  report(
    'C2 shared standee links PUT → 200 (standee feature, not capped by card limit)',
    manyShared.status === 200,
    `${manyShared.status} ${manyShared.body?.error ?? ''}`
  );

  /* D. Profile-only customer — profile + social(4), review editing denied. */
  const profileFeatures = await get(profileCookie, '/api/my/features');
  let pf: Record<string, { enabled?: boolean; max?: number }> = {};
  try {
    pf = JSON.parse(profileFeatures.body)?.features ?? {};
  } catch {
    /* keep {} */
  }
  report(
    'D /api/my/features: profile + social(max 4) for profile-only customer',
    profileFeatures.status === 200 &&
      pf.profile?.enabled === true &&
      pf.social?.enabled === true &&
      pf.social?.max === 4 &&
      pf.review?.enabled === false &&
      pf.standee?.enabled === false,
    JSON.stringify(pf)
  );

  const profileCardId = String(cardIds['M10-PROFILE-PROD-CARD'] ?? '');
  const reviewEdit = await patch(profileCookie, `/api/cards/${profileCardId}`, {
    reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.com/x' },
  });
  report(
    'D2 review assistant editing → 403 for profile-only customer',
    reviewEdit.status === 403,
    `${reviewEdit.status} ${reviewEdit.body?.error ?? ''}`
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});