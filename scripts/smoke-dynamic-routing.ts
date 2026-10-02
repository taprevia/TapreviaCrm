/**
 * smoke-dynamic-routing.ts — HTTP-level end-to-end verification of the PRIMARY
 * acceptance criterion:
 *
 *   "A customer changes the destination behind their QR/NFC product without
 *    replacing, reprinting, or reprogramming the physical product."
 *
 * This test requires a running production-build server:
 *   MONGODB_URI=... npm run build && npm start -- -p 3101
 *   SMOKE_BASE_URL=http://localhost:3101 npx tsx scripts/smoke-dynamic-routing.ts
 *
 * Flow verified:
 *   1. Admin assigns a product (creates entitlement + instance, setup required)
 *   2. Customer configures the destination via authenticated API
 *   3. QR/NFC permanent route /r/{slug} resolves to the configured destination
 *   4. Customer changes the destination
 *   5. The SAME /r/{slug} resolves to the NEW destination (no replacement)
 *   6. Authorization: another customer cannot read/modify this product
 *   7. Entitlement: an unowned product is not accessible
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import CatalogProduct from '../src/models/CatalogProduct';
import UserProduct from '../src/models/UserProduct';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3101';

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

async function request(path: string, cookie?: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> ?? {}) };
  if (cookie) headers.cookie = cookie;
  // Browsers send a same-origin Origin on state-changing requests; the app's
  // CSRF gate rejects cookie-authed mutations without it.
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.origin = BASE;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { status: res.status, location: res.headers.get('location') ?? '', body };
}

const URL_RE = /^https?:\/\/.+/;
const REDIRECT = (s: number) => s === 307 || s === 302;

async function loginCookie(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

async function createUser(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Dyn', email, password }),
  });
  return res;
}

const REGISTERED: string[] = [];

async function ensureUser(email: string, password: string): Promise<string> {
  // Try login; if it fails, register.
  let cookie = await loginCookie(email, password);
  if (!cookie) {
    await createUser(email, password);
    cookie = (await loginCookie(email, password)) as string;
  }
  return cookie;
}

async function run() {
  console.log(`Connecting ${MONGODB_URI} …`);
  await mongoose.connect(MONGODB_URI);

  // ── Fixture users ────────────────────────────────────────────────────────
  const customerA = await ensureUser('smoke.dyna@taprevia.com', 'password123!');
  const customerB = await ensureUser('smoke.dynb@taprevia.com', 'password123!');
  const admin = await loginCookie('admin@taprevia.com', 'admin123');
  report('fixture: customer A authenticated', !!customerA);
  report('fixture: admin authenticated', !!admin);

  // ── Admin assigns an Insta Card product to customer A ────────────────────
  const userA = await User.findOne({ email: 'smoke.dyna@taprevia.com' });
  if (!userA) { console.error('customer A not found'); process.exit(2); }

  // Clean previous assignments.
  const prevUps = await UserProduct.find({ userId: userA._id });
  for (const up of prevUps) {
    if (up.cardId) await Card.deleteOne({ _id: up.cardId });
    await UserProduct.deleteOne({ _id: up._id });
  }

  const instaCat = await CatalogProduct.findOne({ slug: 'insta-card' });
  if (!instaCat) { console.error('insta-card not seeded'); process.exit(2); }

  // Create an unassigned physical card.
  const card = await Card.create({
    cardUid: `SDYNA${Math.floor(Math.random() * 10000)}`,
    slug: `sdyna-${Math.floor(Math.random() * 10000)}`,
    routeSlug: `r${Math.floor(Math.random() * 100000000)}`,
    status: 'unassigned',
    kind: 'profile',
  });

  const assignRes = await fetch(`${BASE}/api/admin/users/${userA._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin!, origin: BASE },
    body: JSON.stringify({ catalogProductId: instaCat._id, quantity: 1, cardUid: card.cardUid }),
  });
  const assignBody = await assignRes.json().catch(() => ({}));
  report('1a. admin assigns Insta product (HTTP)', assignRes.status === 201, `status=${assignRes.status} ${JSON.stringify(assignBody).slice(0,200)}`);

  // The card's routeSlug now holds the permanent route.
  const reloaded = await Card.findOne({ cardUid: card.cardUid });
  if (!reloaded || !reloaded.routeSlug) {
    report('1b. card has permanent route', false);
    process.exit(2);
  }
  report('1b. card has permanent route', true, reloaded.routeSlug);
  const routeSlug = reloaded.routeSlug;
  const permanentRoute = `/r/${routeSlug}`;

  // Find the assignment ID for the config API.
  const up = await UserProduct.findOne({ userId: userA._id, cardId: reloaded._id });
  const assignmentId = String(up?._id ?? '');

  // ── Customer A configures destination (initial) ──────────────────────────
  const OLD_DEST = 'https://instagram.com/oldaccount';
  const configRes = await fetch(`${BASE}/api/my/products/${assignmentId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: customerA!, origin: BASE },
    body: JSON.stringify({ destinationUrl: OLD_DEST }),
  });
  report('2a. customer A configures destination (HTTP)', configRes.status === 200, `status=${configRes.status}`);

  // ── QR/NFC permanent route resolves to current destination (OLD) ─────────
  const qrOld = await request(permanentRoute);
  report(
    '3a. /r/{slug} resolves to configured destination',
    REDIRECT(qrOld.status) && qrOld.location === OLD_DEST,
    `status=${qrOld.status} loc=${qrOld.location}`
  );

  // ── Customer A changes destination ───────────────────────────────────────
  const NEW_DEST = 'https://instagram.com/newaccount';
  const changeRes = await fetch(`${BASE}/api/my/products/${assignmentId}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: customerA!, origin: BASE },
    body: JSON.stringify({ destinationUrl: NEW_DEST }),
  });
  report('4a. customer A changes destination (HTTP)', changeRes.status === 200, `status=${changeRes.status}`);

  // ── SAME permanent route now resolves to NEW destination ────────────────
  const qrNew = await request(permanentRoute);
  report(
    '4b. SAME /r/{slug} resolves to NEW destination (no replacement)',
    REDIRECT(qrNew.status) && qrNew.location === NEW_DEST,
    `status=${qrNew.status} loc=${qrNew.location}`
  );
  report(
    '4c. same physical route stays constant',
    qrNew.location === NEW_DEST && qrOld.location === OLD_DEST
  );

  // The QR itself (base64) identity — the QR encodes the permanent route, not
  // the destination, so changing destination never invalidates the printed QR.
  // (Verified by /api/my/qr returning a PNG for the permanent route below.)
  const qrRes = await fetch(`${BASE}/api/my/qr?slug=${routeSlug}`, {
    headers: { cookie: customerA! },
  });
  const qrArrayBuf = await qrRes.arrayBuffer().catch(() => null);
  const qrBuf = qrArrayBuf ? Buffer.from(qrArrayBuf) : Buffer.alloc(0);
  report('5a. QR generated from permanent route (HTTP)', qrRes.status === 200 && qrBuf.length > 1000, `status=${qrRes.status} bytes=${qrBuf.length}`);

  // ── Authorization: customer B cannot read A's assignment ────────────────
  const bRead = await request(`/api/my/products/${assignmentId}`, customerB);
  report('6a. customer B cannot read A\'s product', bRead.status === 404 || bRead.status === 403, `status=${bRead.status}`);

  // ── Entitlement: A cannot modify a product they don't own ───────────────
  const userB = await User.findOne({ email: 'smoke.dynb@taprevia.com' });
  const bCat = await CatalogProduct.findOne({ slug: 'business-nfc-card' });
  const bCard = await Card.create({ cardUid: `SDYNB${Math.floor(Math.random() * 10000)}`, slug: `sdynb-${Math.floor(Math.random() * 10000)}`, routeSlug: `r${Math.floor(Math.random() * 100000000)}`, status: 'unassigned', kind: 'profile' });
  if (userB) {
    const bAssign = await fetch(`${BASE}/api/admin/users/${userB._id}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin!, origin: BASE },
      body: JSON.stringify({ catalogProductId: bCat!._id, quantity: 1, cardUid: bCard.cardUid }),
    });
    const bUp = await UserProduct.findOne({ userId: userB._id, cardId: bCard._id });
    const bConfig = await fetch(`${BASE}/api/my/products/${bUp?._id}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: customerA!, origin: BASE }, // A trying to modify B's
      body: JSON.stringify({ destinationUrl: 'https://instagram.com/hacked' }),
    });
    report('7a. customer A cannot modify customer B\'s product', bConfig.status === 404 || bConfig.status === 403, `status=${bConfig.status}`);
  }

  await mongoose.disconnect();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error('Smoke crash:', error);
  process.exit(2);
});
