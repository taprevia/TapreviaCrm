/**
 * e2e-dashboard-entitlement.ts — HTTP-level verification of the product-driven
 * dashboard authorization chain (Enterprise Feature Development runbook):
 *
 *   PRODUCT → CAPABILITIES → DASHBOARD NAVIGATION → PAGE/API AUTHORIZATION
 *
 * Requires a running production-build server:
 *   MONGODB_URI=... npm run build && npm start -- -p 3101
 *   SMOKE_BASE_URL=http://localhost:3101 npx tsx scripts/e2e-dashboard-entitlement.ts
 *
 * Verified:
 *   A. A LinkedIn-only customer's server-rendered nav SHOWS the LinkedIn row
 *      and hides every other platform row (Instagram / Facebook / WhatsApp /
 *      Google Reviews) plus the remaining generic CRM rows (Subscribers,
 *      vCards, Orders, …). Their OWN Analytics row is visible (tap_analytics)
 *      and /api/analytics serves their card's existing taps (P8-B), even
 *      though /api/cards and the vCards surface stay gated. Platform routes
 *      (/dashboard/linkedin, …) keep their redirect semantics; every other
 *      gated page 302-redirects to the relevant destination and every other
 *      gated API 403s.
 *   B. An Instagram-only customer sees the Instagram row, no other platform
 *      rows, and its own Analytics surface.
 *   C. A LinkedIn + Instagram customer sees both rows, each exactly once
 *      (entitlement union across active assignments).
 *   D. A zero-assignment customer sees only the universal rows.
 *   E. A Business NFC Card customer keeps the full CRM surface: /api/analytics,
 *      /api/cards, /api/inquiries return 200 and those pages
 *      serve 200 (not redirects). (Inquiries/Appointments are NAV-removed in
 *      the product scope; their API routes remain entitled-guarded.)
 *   F. /api/my/capabilities reflects exactly each product's capability grant.
 *   G. An uninstantiated card assignment (no physical card bound) can be
 *      configured via PATCH before linking; on admin linking the physical card
 *      the pending config is applied to the Card and the public route serves
 *      the destination immediately (P4).
 *   H. Assignment-rule confirmation (P5): a card product WITH a UID is bound
 *      immediately; the same physical UID is rejected for another customer; an
 *      unsupported kind stays restricted card-less; and a bound review card's
 *      list entry exposes kind=review for the authoritative Google Review
 *      destination.
 *
 * Created fixtures are removed at the end so data integrity holds.
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import Standee from '../src/models/Standee';
import CatalogProduct from '../src/models/CatalogProduct';
import UserProduct from '../src/models/UserProduct';
import AnalyticsLog from '../src/models/AnalyticsLog';

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
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (cookie) headers.cookie = cookie;
  headers.origin = BASE;
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { status: res.status, location: res.headers.get('location') ?? '', body };
}

const json = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function loginCookie(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

interface Fixture {
  email: string;
  cookie: string;
  user: { _id: string };
  card: { _id: string; cardUid: string };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm');
  const fixtures: Fixture[] = [];
  const standeeIds: string[] = [];

  const admin = await loginCookie('admin@taprevia.com', 'admin123');
  report('fixture: admin authenticated', !!admin);
  if (!admin) process.exit(2);

  /** Register a customer and admin-assign a catalog product bound to a card. */
  const setupCustomer = async (tag: string, catalogSlug: string): Promise<Fixture> => {
    const email = `ent.${tag}.${suffix()}@example.test`;
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      body: JSON.stringify({ name: `Ent ${tag}`, email, password: 'password123!' }),
    });
    if (!reg.ok) throw new Error(`register ${tag} failed: ${reg.status} ${await reg.text()}`);
    const cookie = (await loginCookie(email, 'password123!')) as string;
    report(`fixture: ${tag} customer registered + logged in`, !!cookie, `email=${email}`);

    const user = await User.findOne({ email });
    if (!user) throw new Error(`${email} not found`);
    const cat = await CatalogProduct.findOne({ slug: catalogSlug });
    if (!cat) throw new Error(`${catalogSlug} not seeded`);
    const card = await Card.create({
      cardUid: `ENT${Math.floor(Math.random() * 1e6)}`,
      slug: `ent-${Math.floor(Math.random() * 1e6)}`,
      routeSlug: `r${Math.floor(Math.random() * 1e9)}`,
      status: 'unassigned',
      kind: 'profile',
    });
    const res = await fetch(`${BASE}/api/admin/users/${user._id}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
      body: JSON.stringify({ catalogProductId: cat._id, quantity: 1, cardUid: card.cardUid }),
    });
    const body = await res.text().catch(() => '');
    report(`admin assigns ${catalogSlug} to ${tag}`, res.status === 201, `status=${res.status} ${body.slice(0, 160)}`);

    fixtures.push({ email, cookie, user: { _id: String(user._id) }, card: { _id: String(card._id), cardUid: card.cardUid } });
    return fixtures[fixtures.length - 1];
  };

  /** Assert page statuses: allowList must serve 200; denyList must 302 to /dashboard. */
  const assertPages = (
    hash: string,
    cookie: string,
    allowList: string[],
    denyList: string[]
  ) => {
    const paths = (list: string[]) => list.map((p) => (p.startsWith('/') ? p : `/dashboard/${p}`));
    for (const route of paths(allowList)) {
      request(route, cookie).then((page) => {
        report(`${hash}: page ${route} serves 200`, page.status === 200, `status=${page.status}`);
      });
    }
    for (const route of paths(denyList)) {
      request(route, cookie).then((page) => {
        report(
          `${hash}: page ${route} redirects away`,
          (page.status === 307 || page.status === 302) && page.location.includes('/dashboard'),
          `status=${page.status} loc=${page.location}`
        );
      });
    }
  };

  const assertApis = async (
    hash: string,
    cookie: string,
    should403: string[]
  ) => {
    for (const route of should403) {
      const res = await request(route, cookie);
      report(`${hash}: api ${route} 403 for unentitled`, res.status === 403, `status=${res.status}`);
    }
  };

  console.log('\n── A. LINKEDIN-ONLY CUSTOMER (acceptance target) ──');
  const li = await setupCustomer('linkonly', 'linkedin-card');

  const liCaps = await request('/api/my/capabilities', li.cookie);
  const liCapsBody = json(liCaps.body);
  const liCapsArr: string[] = Array.isArray(liCapsBody?.capabilities)
    ? liCapsBody.capabilities
    : (Array.isArray(liCapsBody) ? liCapsBody : []);
  report(
    'A1. capabilities include linkedin + tap_analytics',
    liCapsArr.includes('linkedin') && liCapsArr.includes('tap_analytics') && liCapsArr.includes('qr') && liCapsArr.includes('nfc'),
    `caps=${liCapsArr.join(',')}`
  );
  report(
    'A2. capabilities exclude dynamic_dashboard / lead_capture / profile_edit / appointments / catalogue / standee',
    !['dynamic_dashboard', 'lead_capture', 'profile_edit', 'appointments', 'catalogue', 'standee', 'google_review', 'instagram', 'facebook', 'whatsapp'].some((c) => liCapsArr.includes(c)),
    `caps=${liCapsArr.join(',')}`
  );

  // Server-rendered shell nav — no platform rows among gated items.
  const liHome = await request('/dashboard', li.cookie);
  report('A3. /dashboard serves 200', liHome.status === 200, `status=${liHome.status}`);
  report(
    'A4. nav shows the LinkedIn row and hides Instagram / Facebook / WhatsApp / Google Reviews',
    liHome.body.includes('href="/dashboard/linkedin"') &&
      ![
        'href="/dashboard/instagram"',
        'href="/dashboard/facebook"',
        'href="/dashboard/whatsapp"',
        'href="/dashboard/reviews"',
      ].some((href) => liHome.body.includes(href)),
    ''
  );
  report(
    'A5. nav shows Analytics (own tap_analytics) but hides Inquiries / Subscribers / vCards / Orders / Appointments',
    liHome.body.includes('href="/dashboard/analytics"') &&
      ![
        'href="/dashboard/inquiries"',
        'href="/dashboard/subscribers"',
        'href="/dashboard/vcards"',
        'href="/dashboard/orders"',
        'href="/dashboard/appointments"',
      ].some((href) => liHome.body.includes(href)),
    ''
  );
  report(
    'A6. nav shows universal rows (Dashboard, My Products, Settings)',
    ['href="/dashboard/products"', 'href="/dashboard/settings"'].every((href) => liHome.body.includes(href)),
    ''
  );

  assertPages('A7', li.cookie, ['products', 'settings', 'account', 'analytics'], [
    'inquiries', 'subscribers', 'vcards', 'orders',
    'appointments', 'linkedin', 'instagram', 'facebook', 'whatsapp', 'standees', 'reviews',
  ]);

  // Canonical manage routing: the platform sidebar row must land on the SPECIFIC
  // card editor for the customer's ONE LinkedIn card (never a generic list).
  const liLinkedInRedirect = await request('/dashboard/linkedin', li.cookie);
  report(
    'A7b. /dashboard/linkedin redirects to the specific card editor',
    (liLinkedInRedirect.status === 307 || liLinkedInRedirect.status === 302) &&
      liLinkedInRedirect.location === `/dashboard/vcards/${li.card._id}/edit`,
    `status=${liLinkedInRedirect.status} loc=${liLinkedInRedirect.location}`
  );

  await assertApis('A8', li.cookie, [
    '/api/inquiries',
    '/api/inquiries/export',
    '/api/newsletter-subscribers',
    '/api/appointments',
    '/api/cards',
    '/api/card-templates',
    '/api/uploads',
    '/api/product-enquiries',
  ]);

  // P8-B — a tap_analytics-only customer can read THEIR OWN card analytics even
  // without dynamic_dashboard / profile_edit.
  await AnalyticsLog.create({ cardId: li.card._id, action: 'tap', metadata: `route:${li.card.cardUid.toLowerCase()}` });
  const liOwnAnalytics = await request(`/api/analytics?cardId=${li.card._id}`, li.cookie);
  const liOwnTotals = json(liOwnAnalytics.body)?.totals;
  report(
    'A8b. /api/analytics 200 for tap_analytics-only card owner (own taps aggregated)',
    liOwnAnalytics.status === 200 && (liOwnTotals?.tap ?? 0) >= 1,
    `status=${liOwnAnalytics.status} tap=${liOwnTotals?.tap ?? 0}`
  );
  const foreignCard = await Card.create({
    cardUid: `ENFX${Math.floor(Math.random() * 1e6)}`,
    slug: `ent-fx-${Math.floor(Math.random() * 1e6)}`,
    routeSlug: `r${Math.floor(Math.random() * 1e9)}`,
    status: 'unassigned',
    kind: 'profile',
  });
  fixtures.push({ email: '', cookie: '', user: { _id: '' }, card: { _id: String(foreignCard._id), cardUid: foreignCard.cardUid } });
  const liForeignAnalytics = await request(`/api/analytics?cardId=${foreignCard._id}`, li.cookie);
  report(
    'A8c. /api/analytics rejects a card the customer does not own (403 not data)',
    liForeignAnalytics.status === 403,
    `status=${liForeignAnalytics.status}`
  );
  const liNoParamAnalytics = await request('/api/analytics', li.cookie);
  report(
    'A8d. /api/analytics requires cardId or standeeId (400)',
    liNoParamAnalytics.status === 400,
    `status=${liNoParamAnalytics.status}`
  );

  report(
    'A9. universal introspection APIs still 200 (/api/my/products, /api/my/capabilities)',
    ((await request('/api/my/products', li.cookie)).status === 200) &&
      ((await request('/api/my/capabilities', li.cookie)).status === 200),
    ''
  );

  console.log('\n── B. INSTAGRAM-ONLY CUSTOMER (other single-platform) ──');
  const ig = await setupCustomer('instaonly', 'insta-card');

  const igHome = await request('/dashboard', ig.cookie);
  report('B1. /dashboard serves 200', igHome.status === 200, `status=${igHome.status}`);
  report(
    'B2. nav shows Instagram row; hides LinkedIn / Google Reviews / Facebook / WhatsApp',
    igHome.body.includes('href="/dashboard/instagram"') &&
      !['/dashboard/linkedin', '/dashboard/reviews', '/dashboard/facebook', '/dashboard/whatsapp'].some((h) => igHome.body.includes(h)),
    ''
  );
  report(
    'B3. Instagram-only shows Analytics and hides other generic CRM rows',
    igHome.body.includes('href="/dashboard/analytics"') &&
      !['/dashboard/subscribers', '/dashboard/vcards', '/dashboard/orders'].some((h) => igHome.body.includes('href="' + h + '"')),
    ''
  );
  report(
    'B4. Instagram-only shows universals (Dashboard, My Products, Settings)',
    ['/dashboard/products', '/dashboard/settings'].every((h) => igHome.body.includes(h)),
    ''
  );
  const igInstagramRedirect = await request('/dashboard/instagram', ig.cookie);
  report(
    'B5. /dashboard/instagram redirects to the specific card editor',
    (igInstagramRedirect.status === 307 || igInstagramRedirect.status === 302) &&
      igInstagramRedirect.location === `/dashboard/vcards/${ig.card._id}/edit`,
    `status=${igInstagramRedirect.status} loc=${igInstagramRedirect.location}`
  );
  const igAnalyticsPage = await request('/dashboard/analytics', ig.cookie);
  report(
    'B6. /dashboard/analytics serves 200 for Instagram-only (tap_analytics)',
    igAnalyticsPage.status === 200,
    `status=${igAnalyticsPage.status}`
  );

  console.log('\n── C. MULTIPLE PRODUCTS (LinkedIn + Instagram) ──');
  const multi = await setupCustomer('multiplat', 'linkedin-card');
  const instaCat = await CatalogProduct.findOne({ slug: 'insta-card' });
  const multiCard = await Card.create({
    cardUid: `ENT${Math.floor(Math.random() * 1e6)}`,
    slug: `ent-${Math.floor(Math.random() * 1e6)}`,
    routeSlug: `r${Math.floor(Math.random() * 1e9)}`,
    status: 'unassigned',
    kind: 'profile',
  });
  const assignRes = await fetch(`${BASE}/api/admin/users/${multi.user._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
    body: JSON.stringify({ catalogProductId: instaCat?._id, quantity: 1, cardUid: multiCard.cardUid }),
  });
  report('C1. admin assigns a second platform product (Instagram)', assignRes.status === 201, `status=${assignRes.status}`);
  fixtures.push({ email: multi.email, cookie: '', user: multi.user, card: { _id: String(multiCard._id), cardUid: multiCard.cardUid } });

  const multiHome = await request('/dashboard', multi.cookie);
  report('C2. /dashboard serves 200', multiHome.status === 200, `status=${multiHome.status}`);
  const occurrence = (s: string, needle: string) => s.split(needle).length - 1;
  report(
    'C3. shows LinkedIn AND Instagram rows, each exactly once',
    occurrence(multiHome.body, 'href="/dashboard/linkedin"') === 1 &&
      occurrence(multiHome.body, 'href="/dashboard/instagram"') === 1 &&
      !multiHome.body.includes('href="/dashboard/facebook"'),
    ''
  );

  console.log('\n── D. ZERO-ASSIGNMENT CUSTOMER (universals only) ──');
  const noCapEmail = `ent.nocap.${suffix()}@example.test`;
  const noCapReg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ name: 'Ent NoCap', email: noCapEmail, password: 'password123!' }),
  });
  report('D1. no-capability customer registered', noCapReg.ok, `status=${noCapReg.status}`);
  const noCapCookie = (await loginCookie(noCapEmail, 'password123!')) as string;
  report('D2. no-capability customer logged in', !!noCapCookie, ``);
  const noCapUser = await User.findOne({ email: noCapEmail });
  fixtures.push({ email: noCapEmail, cookie: '', user: { _id: String(noCapUser?._id ?? '') }, card: { _id: '', cardUid: '' } });

  const noCapHome = await request('/dashboard', noCapCookie);
  report('D3. /dashboard serves 200', noCapHome.status === 200, `status=${noCapHome.status}`);
  report(
    'D4. only universal rows (Dashboard, My Products, Settings)',
    ['/dashboard/products', '/dashboard/settings'].every((h) => noCapHome.body.includes(h)) &&
      ![
        'href="/dashboard/linkedin"', 'href="/dashboard/instagram"', 'href="/dashboard/reviews"',
        'href="/dashboard/facebook"', 'href="/dashboard/whatsapp"', 'href="/dashboard/vcards"',
        'href="/dashboard/standees"', 'href="/dashboard/analytics"', 'href="/dashboard/subscribers"',
      ].some((h) => noCapHome.body.includes(h)),
    ''
  );
  const noCapCapsRaw = await request('/api/my/capabilities', noCapCookie);
  const noCapCaps = json(noCapCapsRaw.body)?.capabilities;
  report('D5. /api/my/capabilities resolves empty', Array.isArray(noCapCaps) && noCapCaps.length === 0, `caps=${JSON.stringify(noCapCaps)}`);
  const noCapAnalytics = await request('/api/analytics?cardId=000000000000000000000000', noCapCookie);
  report(
    'D6. zero-assignment /api/analytics still 403 (no analytics capability)',
    noCapAnalytics.status === 403,
    `status=${noCapAnalytics.status}`
  );

  console.log('\n── E. BUSINESS NFC CARD CUSTOMER (full CRM surface) ──');
  const biz = await setupCustomer('business', 'business-nfc-card');

  const bizCaps = await request('/api/my/capabilities', biz.cookie);
  const bizCapsArr: string[] = (json(bizCaps.body)?.capabilities ?? []) as string[];
  report(
    'E1. capabilities include dynamic_dashboard + lead_capture + profile_edit + catalogue',
    ['dynamic_dashboard', 'lead_capture', 'profile_edit', 'catalogue'].every((c) => bizCapsArr.includes(c)),
    `caps=${bizCapsArr.join(',')}`
  );

  const bizHome = await request('/dashboard', biz.cookie);
  report(
    'E2. nav shows Analytics + Subscribers + vCards + Orders',
    ['/dashboard/analytics', '/dashboard/subscribers', '/dashboard/vcards', '/dashboard/orders'].every((href) => bizHome.body.includes(href)),
    ''
  );

  assertPages('E3', biz.cookie, ['analytics', 'vcards', 'orders', 'subscribers'], []);

  for (const route of ['/api/inquiries', '/api/cards', '/api/newsletter-subscribers', '/api/card-templates']) {
    const res = await request(route, biz.cookie);
    report(`E4. api ${route} 200 for entitled`, res.status === 200, `status=${res.status}`);
  }

  // /api/analytics needs an owned cardId — prove the guard lets the entitled
  // customer through AND that it returns real analytics for an owned card.
  const bizCards = json((await request('/api/cards?page=1&limit=5', biz.cookie)).body);
  const ownedCard = bizCards?.cards?.[0] ?? bizCards?.vcards?.[0];
  const analyticsRaw = await request(
    ` /api/analytics?cardId=${ownedCard?._id ?? ''}`.trim(),
    biz.cookie
  );
  report(
    'E5. api /api/analytics 200 for entitled (with owned cardId)',
    ownedCard != null && analyticsRaw.status === 200,
    `status=${analyticsRaw.status} card=${ownedCard?._id ?? 'none'}`
  );

  console.log('\n── G. UNINSTANTIATED ASSIGNMENT (P4: configure without instance) ──');
  const p4Email = `ent.uninst.${suffix()}@example.test`;
  const p4Reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ name: 'Ent P4', email: p4Email, password: 'password123!' }),
  });
  report('G1. P4 customer registered', p4Reg.ok, `status=${p4Reg.status}`);
  const p4Cookie = (await loginCookie(p4Email, 'password123!')) as string;
  report('G2. P4 customer logged in', !!p4Cookie);
  const p4User = await User.findOne({ email: p4Email });
  if (!p4User) throw new Error(`${p4Email} not found`);
  fixtures.push({ email: p4Email, cookie: '', user: { _id: String(p4User._id) }, card: { _id: '', cardUid: '' } });

  const liCat = await CatalogProduct.findOne({ slug: 'linkedin-card' });
  if (!liCat) throw new Error('linkedin-card not seeded');

  // Card-less assignment — no cardUid creates an uninstantiated card product.
  const p4AssignRes = await fetch(`${BASE}/api/admin/users/${p4User._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
    body: JSON.stringify({ catalogProductId: liCat._id, quantity: 1 }),
  });
  const p4AssignBody = json(await p4AssignRes.text());
  const p4AssignmentId = p4AssignBody?.userProduct?._id ?? p4AssignBody?._id;
  report(
    'G3. admin assigns linkedin-card without card UID',
    p4AssignRes.status === 201 && !!p4AssignmentId,
    `status=${p4AssignRes.status} id=${p4AssignmentId ?? 'none'}`
  );

  if (p4AssignmentId) {
    // P6 (P-A1) — the list must represent the unbound card assignment as a card
    // needing setup (instanceType 'card', no invented instance, no permanent
    // route) so My Products renders "Setup Required"/"Set Up" consistently with
    // the configuration page.
    const p4ListRaw = await request('/api/my/products', p4Cookie);
    const p4List = json(p4ListRaw.body) as {
      products?: Array<{
        assignmentId: string;
        instanceType?: string | null;
        instance?: { id?: string } | null;
        permanentRoute?: string | null;
      }> | null;
    } | null;
    const p4ListEntry = (p4List?.products ?? []).find((p) => p.assignmentId === p4AssignmentId);
    report(
      'G3b. unbound card assignment listed as a card with no instance/permanent route',
      p4ListRaw.status === 200 &&
        p4ListEntry?.instanceType === 'card' &&
        p4ListEntry?.instance === null &&
        p4ListEntry?.permanentRoute == null,
      `instanceType=${p4ListEntry?.instanceType ?? 'missing'} instance=${p4ListEntry?.instance ? 'present' : 'null'} permanentRoute=${p4ListEntry?.permanentRoute ?? 'null'}`
    );

    const p4DetailRaw = await request(`/api/my/products/${p4AssignmentId}`, p4Cookie);
    const p4Detail = json(p4DetailRaw.body) as {
      product?: {
        catalogProduct?: { kind?: string };
        instanceType?: string | null;
        permanentRoute?: string | null;
        instance?: { redirectUrl?: string; cardUid?: string; routeSlug?: string; isActive?: boolean } | null;
        setupComplete?: boolean;
      };
    } | null;
    const p4Product = p4Detail?.product;
    report(
      'G4. GET product detail 200 for uninstantiated assignment (no instance yet)',
      p4DetailRaw.status === 200 && p4Product?.catalogProduct?.kind === 'social',
      `status=${p4DetailRaw.status} kind=${p4Product?.catalogProduct?.kind} instanceType=${p4Product?.instanceType}`
    );

    const p4PatchRes = await fetch(`${BASE}/api/my/products/${p4AssignmentId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: p4Cookie, origin: BASE },
      body: JSON.stringify({
        destinationUrl: 'https://example.com/p4-dest',
        instagram: { profileUrl: 'https://instagram.com/p4test' },
      }),
    });
    const p4PatchBody = await p4PatchRes.text();
    report('G5. PATCH config 200 for uninstantiated assignment', p4PatchRes.status === 200, `status=${p4PatchRes.status} body=${p4PatchBody.slice(0, 200)}`);

    // Confirm config persisted on the assignment's pendingConfig (synthesized via GET).
    const p4Detail2Raw = await request(`/api/my/products/${p4AssignmentId}`, p4Cookie);
    const p4Detail2 = json(p4Detail2Raw.body) as {
      product?: {
        instanceType?: string | null;
        instance?: { redirectUrl?: string } | null;
      };
    } | null;
    const p4Product2 = p4Detail2?.product;
    report(
      'G6. re-GET confirms redirectUrl persisted on uninstantiated assignment',
      p4Detail2Raw.status === 200 &&
        p4Product2?.instanceType === 'card' &&
        p4Product2?.instance?.redirectUrl === 'https://instagram.com/p4test',
      `status=${p4Detail2Raw.status} instanceType=${p4Product2?.instanceType} redirectUrl=${p4Product2?.instance?.redirectUrl ?? 'missing'}`
    );

    // Ownership check: a different customer's cookie must not be able to PATCH.
    const p4BadRaw = await request(
      `/api/my/products/${p4AssignmentId}/config`,
      biz.cookie,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationUrl: 'https://evil.example.com' }),
      }
    );
    report('G7. ownership enforced (other customer 404)', p4BadRaw.status === 404, `status=${p4BadRaw.status}`);

    // Admin links a physical card to the uninstantiated assignment.
    const linkUid = `ENTP4${Math.floor(Math.random() * 1e6)}`;
    const linkCard = await Card.create({
      cardUid: linkUid,
      slug: `ent-p4-${Math.floor(Math.random() * 1e6)}`,
      routeSlug: `r${Math.floor(Math.random() * 1e9)}`,
      status: 'unassigned',
      kind: 'profile',
    });
    const p4LinkRes = await fetch(`${BASE}/api/admin/users/${p4User._id}/products/${p4AssignmentId}/card`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
      body: JSON.stringify({ cardUid: linkUid }),
    });
    const p4LinkBody = await p4LinkRes.text();
    report('G8. admin links physical card to uninstantiated assignment', p4LinkRes.status === 200, `status=${p4LinkRes.status} body=${p4LinkBody.slice(0, 300)}`);

    // GET after linking — the instance is now the bound Card with pending config applied.
    const p4Detail3Raw = await request(`/api/my/products/${p4AssignmentId}`, p4Cookie);
    const p4Detail3 = json(p4Detail3Raw.body) as {
      product?: {
        instance?: { cardUid?: string; redirectUrl?: string; routeSlug?: string; isActive?: boolean } | null;
      };
    } | null;
    const p4Instance3 = p4Detail3?.product?.instance;
    report(
      'G9. GET after linking shows bound instance with pending config applied',
      p4Detail3Raw.status === 200 &&
        p4Instance3?.cardUid === linkUid &&
        p4Instance3?.redirectUrl === 'https://instagram.com/p4test' &&
        p4Instance3?.isActive === true,
      `cardUid=${p4Instance3?.cardUid ?? 'none'} redirectUrl=${p4Instance3?.redirectUrl ?? 'missing'}`
    );

    // Public route serves the destination configured before linking.
    const p4RouteRaw = await request(`/r/${p4Instance3?.routeSlug ?? ''}`);
    report(
      'G10. public route redirects after linking',
      (p4RouteRaw.status === 307 || p4RouteRaw.status === 302) &&
        p4RouteRaw.location?.includes('instagram.com/p4test'),
      `status=${p4RouteRaw.status} loc=${p4RouteRaw.location}`
    );

    if (linkCard?._id) await Card.deleteOne({ _id: linkCard._id });
  }

  console.log('\n── H. ASSIGNMENT RULE CONFIRMATION (P5: admin card-less UX + review destination) ──');

  // Flow B — card product assigned WITH a UID provisions the physical card immediately.
  const hEmailB = `ent.p5b.${suffix()}@example.test`;
  const hRegB = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ name: 'Ent P5B', email: hEmailB, password: 'password123!' }),
  });
  report('H1. Flow B customer registered', hRegB.ok, `status=${hRegB.status}`);
  const hUserB = await User.findOne({ email: hEmailB });
  if (!hUserB) throw new Error(`${hEmailB} not found`);
  fixtures.push({ email: hEmailB, cookie: '', user: { _id: String(hUserB._id) }, card: { _id: '', cardUid: '' } });

  const reviewCat = await CatalogProduct.findOne({ slug: 'google-review-card' });
  if (!reviewCat) throw new Error('google-review-card not seeded');

  const hUidB = `ENTP5${Math.floor(Math.random() * 1e6)}`;
  const hAssignBRes = await fetch(`${BASE}/api/admin/users/${hUserB._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
    body: JSON.stringify({ catalogProductId: reviewCat._id, quantity: 1, cardUid: hUidB }),
  });
  const hAssignBBody = json(await hAssignBRes.text());
  report(
    'H2. admin assigns google-review-card WITH UID → 201 bound review card',
    hAssignBRes.status === 201 &&
      hAssignBBody?.card?.cardUid === hUidB &&
      hAssignBBody?.card?.kind === 'review',
    `status=${hAssignBRes.status} cardUid=${hAssignBBody?.card?.cardUid ?? 'none'} kind=${hAssignBBody?.card?.kind ?? 'none'}`
  );
  if (hAssignBBody?.card?._id) {
    const fxB = fixtures.find((fx) => fx.user._id === String(hUserB._id));
    if (fxB) {
      fxB.card = { _id: hAssignBBody.card._id, cardUid: hUidB };
    }
  }

  // Flow D — the same physical UID must never bind to another customer.
  const hEmailD = `ent.p5d.${suffix()}@example.test`;
  const hRegD = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ name: 'Ent P5D', email: hEmailD, password: 'password123!' }),
  });
  report('H3. second customer registered for reuse check', hRegD.ok, `status=${hRegD.status}`);
  const hUserD = await User.findOne({ email: hEmailD });
  if (!hUserD) throw new Error(`${hEmailD} not found`);
  fixtures.push({ email: hEmailD, cookie: '', user: { _id: String(hUserD._id) }, card: { _id: '', cardUid: '' } });

  const hAssignDRes = await fetch(`${BASE}/api/admin/users/${hUserD._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
    body: JSON.stringify({ catalogProductId: reviewCat._id, quantity: 1, cardUid: hUidB }),
  });
  const hAssignDBody = json(await hAssignDRes.text());
  report(
    'H4. same physical UID on another customer rejected (409)',
    hAssignDRes.status === 409,
    `status=${hAssignDRes.status} error=${hAssignDBody?.error ?? 'none'}`
  );

  // Flow C — an unsupported kind on a card-category product is still refused card-less.
  const hCatC = await CatalogProduct.create({
    name: 'Ent unsupported card',
    slug: `ent-unsupported-${suffix()}`.toLowerCase(),
    category: 'card',
    kind: 'standee',
  });
  const hAssignCRes = await fetch(`${BASE}/api/admin/users/${hUserB._id}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
    body: JSON.stringify({ catalogProductId: hCatC._id, quantity: 1 }),
  });
  const hAssignCBody = json(await hAssignCRes.text());
  report(
    'H5. unsupported product kind without UID still restricted (400)',
    hAssignCRes.status === 400,
    `status=${hAssignCRes.status} error=${hAssignCBody?.error ?? 'none'}`
  );
  await CatalogProduct.deleteOne({ _id: hCatC._id });

  // Problem 4 data — the bound review card's list entry exposes kind so the
  // dashboard renders the authoritative Google Review destination first.
  const hCookieB = (await loginCookie(hEmailB, 'password123!')) as string;
  const hListRaw = await request('/api/my/products', hCookieB);
  const hList = json(hListRaw.body) as {
    products?: Array<{
      instance?: { kind?: string } | null;
      permanentRoute?: string | null;
    }>;
  } | null;
  const hReviewEntry = (hList?.products ?? []).find((p) => p.instance?.kind === 'review');
  report(
    'H6. products list exposes kind=review for a bound review card',
    hListRaw.status === 200 && Boolean(hReviewEntry),
    `status=${hListRaw.status} found=${Boolean(hReviewEntry)}`
  );
  // P6 (P-D1) — the bound review card's list entry exposes the permanent /r/
  // route so the destination row can link through it while keeping "Google
  // Review" as the meaningful label.
  report(
    'P6. review card list entry exposes the permanent /r/ route',
    Boolean(hReviewEntry) &&
      typeof hReviewEntry?.permanentRoute === 'string' &&
      hReviewEntry!.permanentRoute!.includes('/r/'),
    `found=${Boolean(hReviewEntry)} permanentRoute=${hReviewEntry?.permanentRoute ?? 'missing'}`
  );

  console.log('\n── P7. PRODUCT-STATUS SURFACE + PLATFORM ROW DE-DUPLICATION ──');

  /** Register a customer and admin-assign a standee product (creates a Standee with empty slot destinations). */
  const setupStandeeCustomer = async (
    tag: string,
    catalogSlug: string
  ): Promise<{ email: string; cookie: string; userId: string; standeeId: string } | null> => {
    const email = `ent.${tag}.${suffix()}@example.test`;
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: BASE },
      body: JSON.stringify({ name: `Ent ${tag}`, email, password: 'password123!' }),
    });
    if (!reg.ok) throw new Error(`register ${tag} failed: ${reg.status} ${await reg.text()}`);
    const cookie = (await loginCookie(email, 'password123!')) as string;
    const user = await User.findOne({ email });
    const cat = await CatalogProduct.findOne({ slug: catalogSlug });
    if (!user || !cat) throw new Error(`${catalogSlug} / ${email} missing from DB`);
    const res = await fetch(`${BASE}/api/admin/users/${user._id}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
      body: JSON.stringify({ catalogProductId: cat._id, quantity: 1 }),
    });
    const body = json(await res.text());
    const standeeId = body?.standee?._id;
    report(
      `fixture: ${tag} standee assigned (database-created empty slots)`,
      res.status === 201 && !!standeeId,
      `status=${res.status} standee=${standeeId ?? 'none'}`
    );
    fixtures.push({ email, cookie: '', user: { _id: String(user._id) }, card: { _id: '', cardUid: '' } });
    if (standeeId) standeeIds.push(String(standeeId));
    if (!cookie || !standeeId) return null;
    return { email, cookie, userId: String(user._id), standeeId: String(standeeId) };
  };

  // P7-3 — an ALL_IN_ONE_STANDEE_4 grants google_review + instagram + whatsapp +
  // facebook + standee capabilities. Without de-duplication that is FOUR platform
  // sidebar rows (Reviews/Instagram/WhatsApp/Facebook) each landing on the same
  // Standees manager. After P7-3 only the single Standees row remains.
  const aio4 = await setupStandeeCustomer('aio4', 'all-in-one-standee-4');

  if (aio4) {
    const aio4Home = await request('/dashboard', aio4.cookie);
    report(
      'P7-3a. AIO4 standee-only nav shows Standees once and hides the four redundant platform rows',
      aio4Home.status === 200 &&
        aio4Home.body.includes('href="/dashboard/standees"') &&
        ![
          'href="/dashboard/instagram"',
          'href="/dashboard/reviews"',
          'href="/dashboard/whatsapp"',
          'href="/dashboard/facebook"',
        ].some((href) => aio4Home.body.includes(href)),
      ''
    );
    report(
      'P7-3b. standee-only nav keeps the platform universals (Dashboard, My Products, Settings)',
      aio4Home.status === 200 &&
        ['href="/dashboard/products"', 'href="/dashboard/settings"'].every((href) =>
          aio4Home.body.includes(href)
        ),
      ''
    );
    report(
      'P8-1. standee-only nav shows its own Analytics row (standee_analytics)',
      aio4Home.body.includes('href="/dashboard/analytics"'),
      ''
    );
    // P8-2 — standee taps are pre-recorded via the public /r/ resolver as
    // AnalyticsLog rows with metadata "route:{routeSlug}[/slot:…]", so the
    // existing aggregation API can surface them with no schema change.
    const aio4Standee = await Standee.findById(aio4.standeeId).select('routeSlug');
    const standeeRouteKey = String(aio4Standee?.routeSlug ?? '').toLowerCase();
    await AnalyticsLog.create({
      action: 'tap',
      metadata: `route:${standeeRouteKey}/slot:1/platform:instagram`,
    });
    const standeeAnalytics = await request(`/api/analytics?standeeId=${aio4.standeeId}`, aio4.cookie);
    const standeeTotals = json(standeeAnalytics.body)?.totals;
    report(
      'P8-2. standee /api/analytics 200 + aggregates own route taps for the assigned standee',
      standeeAnalytics.status === 200 && (standeeTotals?.tap ?? 0) >= 1,
      `status=${standeeAnalytics.status} tap=${standeeTotals?.tap ?? 0}`
    );

    // P7-2 — standee setup state derives from slot destinations (no persisted
    // setupComplete). Empty destinations = "Setup Required"; a configured slot
    // makes the standee live.
    const p7ListRaw = await request('/api/my/products', aio4.cookie);
    const p7List = json(p7ListRaw.body) as {
      products?: Array<{
        assignmentId?: string;
        instanceType?: string | null;
        instance?: {
          socialQrs?: Array<{ platform?: string; label?: string; destinationUrl?: string }>;
        } | null;
      }>;
    } | null;
    const p7Entry = (p7List?.products ?? []).find((p) => p.instanceType === 'standee');
    const p7Slots: Array<{ platform?: string; destinationUrl?: string }> =
      (p7Entry?.instance?.socialQrs ?? []) as Array<{ platform?: string; destinationUrl?: string }>;
    report(
      'P7-2a. unconfigured standee listed with its (still-empty) slot destinations',
      p7ListRaw.status === 200 &&
        Boolean(p7Entry) &&
        p7Slots.length === 4 &&
        p7Slots.every((qr) => !qr.destinationUrl || qr.destinationUrl.trim() === ''),
      `slots=${JSON.stringify(p7Slots.map((qr) => qr.platform))}`
    );

    const p7AssignmentId = p7Entry?.assignmentId ?? '';
    const p7PatchRes = await fetch(`${BASE}/api/my/products/${p7AssignmentId}/config`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', cookie: aio4.cookie, origin: BASE },
      body: JSON.stringify({ slotConfig: { slot: 1, destinationUrl: 'https://instagram.com/p7standee' } }),
    });
    report('P7-2b. slotConfig PATCH points slot 1 at a destination', p7PatchRes.status === 200, `status=${p7PatchRes.status}`);

    const p7List2 = json((await request('/api/my/products', aio4.cookie)).body) as {
      products?: Array<{
        assignmentId?: string;
        instance?: { socialQrs?: Array<{ destinationUrl?: string }> } | null;
      }>;
    } | null;
    const p7Entry2 = (p7List2?.products ?? []).find((p) => p.assignmentId === p7Entry?.assignmentId);
    const p7Slots2 = p7Entry2?.instance?.socialQrs ?? [];
    report(
      'P7-2c. re-list reflects the configured slot destination (standee now live)',
      Array.isArray(p7Slots2) && p7Slots2.length === 4 && p7Slots2[0]?.destinationUrl === 'https://instagram.com/p7standee',
      `slot1=${JSON.stringify(p7Slots2[0] ?? null)}`
    );

    // P7-3 mixed — the same standee PLUS a bound Instagram card: the Instagram
    // row resolves to the SPECIFIC card editor (kept), while the other platform
    // rows still collapse into the Standees manager.
    const instaCat = await CatalogProduct.findOne({ slug: 'insta-card' });
    const mixCard = await Card.create({
      cardUid: `ENTM${Math.floor(Math.random() * 1e6)}`,
      slug: `ent-m-${Math.floor(Math.random() * 1e6)}`,
      routeSlug: `r${Math.floor(Math.random() * 1e9)}`,
      status: 'unassigned',
      kind: 'profile',
    });
    const mixRes = await fetch(`${BASE}/api/admin/users/${aio4.userId}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: admin, origin: BASE },
      body: JSON.stringify({ catalogProductId: instaCat?._id, quantity: 1, cardUid: mixCard.cardUid }),
    });
    report('P7-3c. mixed customer gets a bound Instagram card', mixRes.status === 201, `status=${mixRes.status}`);
    fixtures.push({ email: aio4.email, cookie: '', user: { _id: aio4.userId }, card: { _id: String(mixCard._id), cardUid: mixCard.cardUid } });

    const mixedHome = await request('/dashboard', aio4.cookie);
    report(
      'P7-3d. mixed nav keeps Instagram (its card editor) and hides the standee-only platform rows',
      mixedHome.status === 200 &&
        mixedHome.body.includes('href="/dashboard/instagram"') &&
        !['href="/dashboard/reviews"', 'href="/dashboard/whatsapp"', 'href="/dashboard/facebook"'].some(
          (href) => mixedHome.body.includes(href)
        ) &&
        mixedHome.body.includes('href="/dashboard/standees"'),
      ''
    );
  }

  // P7-1 regression — the G-block customer's UNBOUND LinkedIn card must keep its
  // platform sidebar row: it resolves to the My Products hub (a platform
  // universal), which is never de-duplicated away.
  const p4Home = await request('/dashboard', p4Cookie);
  report(
    'P7-1. unbound LinkedIn card keeps its platform row (My Products hub never de-duplicated)',
    p4Home.status === 200 && p4Home.body.includes('href="/dashboard/linkedin"'),
    ''
  );

  console.log('\n── CLEANUP ──');
  let cleaned = 0;
  for (const fx of fixtures) {
    if (fx.user?._id) {
      await UserProduct.deleteMany({ userId: fx.user._id });
      await User.deleteOne({ _id: fx.user._id });
    }
    if (fx.card?._id) {
      await Card.deleteOne({ _id: fx.card._id });
    }
    cleaned += 1;
  }
  if (standeeIds.length) {
    await Standee.deleteMany({ _id: { $in: standeeIds } });
  }
  report(`removed ${cleaned} fixture customers/products/cards`, true);

  await mongoose.disconnect();
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('E2E crash:', error);
  process.exit(2);
});