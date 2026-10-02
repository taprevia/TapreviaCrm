/**
 * verify-human-readable-urls.ts — focused verification of the human-readable
 * public URL feature ("/{business-slug}/{product-slug}[-N]").
 *
 * Covers: single product; multiple same-type numbered slugs; different types;
 * same-business-name collision; NFC routeSlug legacy; QR/alias legacy; legacy
 * profile alias; card replacement permanence; removed-product no-renumber;
 * route-conflict/reserved-prefix safety; rendering reuse; analytics/identity
 * fields untouched.
 *
 * Run with:
 *   MONGODB_URI=mongodb://localhost:27017/nfc-crm npx tsx scripts/verify-human-readable-urls.ts
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import CatalogProduct from '@/models/CatalogProduct';
import Profile from '@/models/Profile';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';
import { replaceCardForAssignment } from '@/lib/services/card-replacement';
import { unbindAssignedCard, getPublicCardByAlias } from '@/lib/services/card-access';
import {
  ensureCardPublicSlug,
  getPublicCardByPublicSlug,
  getPublicProductSlug,
  RESERVED_PUBLIC_SEGMENTS,
} from '@/lib/services/human-url';
import { permanentRouteUrl } from '@/utils/qr-server';
import { generateSlug } from '@/lib/utils';

// ─── Test harness ───────────────────────────────────────────────────────────

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

const stamp = Date.now().toString(36).toUpperCase();
let nfcSeq = 0;

function freshUid(): string {
  nfcSeq += 1;
  return `HUMAN${stamp}${nfcSeq}`;
}

async function ensureCatalog(slug: string, kind: string) {
  const existing = await CatalogProduct.findOne({ slug }).lean();
  if (existing) return existing;
  return CatalogProduct.create({
    name: slug,
    slug,
    category: 'card',
    kind,
    active: true,
    sortOrder: 0,
  });
}

async function makeUser(email: string, name: string): Promise<InstanceType<typeof User>> {
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({ name, email, passwordHash: 'plain-test-password' });
  }
  return user;
}

async function setCompanyName(userId: unknown, name: string): Promise<void> {
  await Profile.findOneAndUpdate(
    { userId },
    { $set: { 'companyInfo.companyName': name } },
    { upsert: true }
  );
}

type HydratedCard = ReturnType<typeof Card.hydrate>;

interface CardSnapshot {
  _id: unknown;
  publicSlug?: string;
  isActive?: boolean;
  urlAlias?: string;
  slug?: string;
  routeSlug?: string;
  cardUid?: string;
  previousCardUids?: string[];
  stats?: { taps?: number };
}

async function leanCard(id: unknown): Promise<CardSnapshot | null> {
  return (await Card.findById(id).lean()) as unknown as CardSnapshot | null;
}

async function assignCard(
  user: InstanceType<typeof User>,
  catalog: InstanceType<typeof CatalogProduct>
): Promise<HydratedCard | null> {
  const result = await assignUserProduct({
    user,
    catalogItem: catalog as InstanceType<typeof CatalogProduct>,
    quantity: 1,
    cardUid: freshUid(),
    assignedBy: user._id.toString(),
  });
  if (!result.ok) {
    console.error('       assignUserProduct failed:', result.error);
    return null;
  }
  // Re-fetch: the returned doc predates the publicSlug allocation write.
  return result.data.card
    ? ((await Card.findById(result.data.card._id)) as unknown as HydratedCard)
    : null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await connectDB();

  const trackedUserIds: unknown[] = [];
  const trackedCardIds: unknown[] = [];

  const trackUser = (id: unknown) => trackedUserIds.push(id);
  const trackCard = (id: unknown) => id && trackedCardIds.push(id);

  try {
    // ── S0 — product → public-slug mapping table ──
    console.log('\nS0  Product mapping');
    report('business-nfc-card → business-card', getPublicProductSlug('business-nfc-card') === 'business-card');
    report('premium-nfc-card → premium-card', getPublicProductSlug('premium-nfc-card') === 'premium-card');
    report('insta-card → instagram', getPublicProductSlug('insta-card') === 'instagram');
    report('linkedin-card → linkedin', getPublicProductSlug('linkedin-card') === 'linkedin');
    report('facebook-card → facebook', getPublicProductSlug('facebook-card') === 'facebook');
    report('google-review-card → google-review', getPublicProductSlug('google-review-card') === 'google-review');
    report('google-review-nfc-plate → google-review', getPublicProductSlug('google-review-nfc-plate') === 'google-review');
    report('standee products have no public slug', getPublicProductSlug('business-profile-standee') === null && getPublicProductSlug('all-in-one-standee-3') === null);
    report('unknown slug → null', getPublicProductSlug('nope-card') === null);

    // ── Catalogue docs (card-category so assignUserProduct provisions Cards) ──
    const catLinkedIn = await ensureCatalog('linkedin-card', 'social');
    const catBusiness = await ensureCatalog('business-nfc-card', 'profile');
    const catInsta = await ensureCatalog('insta-card', 'social');

    // Unique business name per run keeps numbering deterministic even when the
    // dev database already contains accounts with the same company name.
    const bizName = `Acme Corp ${stamp}`;
    const bizBase = generateSlug(bizName);

    // ── S1 — single product ──
    const userA = await makeUser(`humanurl-a-${stamp}@test.local`, bizName);
    trackUser(userA._id);
    await setCompanyName(userA._id, bizName);

    const card1 = await assignCard(userA, catLinkedIn as InstanceType<typeof CatalogProduct>);
    trackCard(card1?._id);
    report('S1  card provisioned', !!card1);
    const p1 = card1?.publicSlug ?? '';
    report('S1  single product → {biz}/linkedin', p1 === `${bizBase}/linkedin`, `got ${p1}`);

    const resolved1 = p1 ? await getPublicCardByPublicSlug(p1) : null;
    report(
      'S1  publicSlug resolves to the same card',
      !!card1 && !!resolved1 && String(resolved1._id) === String(card1._id)
    );
    const noSuch = await getPublicCardByPublicSlug(`${bizBase}/not-a-product`);
    report('S1  unknown product path → 404 surface (null)', noSuch === null);

    // ── S2 — multiple same-type numbered slugs ──
    const card2 = await assignCard(userA, catLinkedIn as InstanceType<typeof CatalogProduct>);
    const card3 = await assignCard(userA, catLinkedIn as InstanceType<typeof CatalogProduct>);
    trackCard(card2?._id);
    trackCard(card3?._id);
    report('S2  second same-type → linkedin-2', card2?.publicSlug === `${bizBase}/linkedin-2`, `got ${card2?.publicSlug}`);
    report('S2  third same-type → linkedin-3', card3?.publicSlug === `${bizBase}/linkedin-3`, `got ${card3?.publicSlug}`);

    const r2 = card2 ? await getPublicCardByPublicSlug(`${bizBase}/linkedin-2`) : null;
    const r3 = card3 ? await getPublicCardByPublicSlug(`${bizBase}/linkedin-3`) : null;
    report('S2  each numbered URL resolves to its own card',
      !!card2 && !!card3 && !!r2 && !!r3 &&
        String(r2._id) === String(card2._id) && String(r3._id) === String(card3._id));
    report('S2  numbered URL ≠ base-URL card', !!r2 && !!resolved1 && String(r2._id) !== String(resolved1._id));

    // ── S3 — different types ──
    const cardBus = await assignCard(userA, catBusiness as InstanceType<typeof CatalogProduct>);
    const cardInsta = await assignCard(userA, catInsta as InstanceType<typeof CatalogProduct>);
    trackCard(cardBus?._id);
    trackCard(cardInsta?._id);
    report('S3  business card slug', cardBus?.publicSlug === `${bizBase}/business-card`, `got ${cardBus?.publicSlug}`);
    report('S3  instagram card slug', cardInsta?.publicSlug === `${bizBase}/instagram`, `got ${cardInsta?.publicSlug}`);
    const rBus = cardBus ? await getPublicCardByPublicSlug(`${bizBase}/business-card`) : null;
    const rInsta = cardInsta ? await getPublicCardByPublicSlug(`${bizBase}/instagram`) : null;
    report('S3  different-type URLs are distinct cards',
      !!cardBus && !!cardInsta && !!rBus && !!rInsta &&
        String(rBus._id) === String(cardBus._id) && String(rInsta._id) === String(cardInsta._id));

    // ── S4 — two accounts with the same business name ──
    const userB = await makeUser(`humanurl-b-${stamp}@test.local`, bizName);
    trackUser(userB._id);
    await setCompanyName(userB._id, bizName);
    const cardB = await assignCard(userB, catBusiness as InstanceType<typeof CatalogProduct>);
    trackCard(cardB?._id);
    report('S4  second same-name account disambiguated → {biz}-2/business-card',
      cardB?.publicSlug === `${bizBase}-2/business-card`, `got ${cardB?.publicSlug}`);
    const rB = cardB ? await getPublicCardByPublicSlug(`${bizBase}-2/business-card`) : null;
    report('S4  disambiguated URL resolves to second account card',
      !!cardB && !!rB && String(rB._id) === String(cardB._id));

    // ── S5 — NFC legacy / permanent route untouched ──
    const hasRoute = !!card1?.routeSlug && /^[a-z0-9]{6,10}$/.test(card1.routeSlug);
    report('S5  routeSlug still present on card', hasRoute, `got ${card1?.routeSlug}`);
    report('S5  permanentRouteUrl still uses /r/{routeSlug}',
      hasRoute && permanentRouteUrl(card1.routeSlug).includes(`/r/${card1.routeSlug}`));
    const byRoute = card1 ? (await Card.findOne({ routeSlug: card1.routeSlug, isActive: true }).lean()) as unknown as CardSnapshot | null : null;
    report('S5  /r fallback resolution still finds the card',
      !!card1 && !!byRoute && String(byRoute._id) === String(card1._id));
    const before = card1?.publicSlug;
    const again = card1 ? await ensureCardPublicSlug(card1._id, userA._id.toString()) : null;
    report('S5  ensureCardPublicSlug idempotent', !!again && again.assigned && again.publicSlug === before && before?.length !== 0);

    // ── S6 — QR/alias legacy ──
    report('S6  urlAlias assigned', !!card1?.urlAlias, `got ${card1?.urlAlias}`);
    const byAlias = card1 ? await getPublicCardByAlias(card1.urlAlias) : null;
    report('S6  legacy getPublicCardByAlias resolves same card',
      !!card1 && !!byAlias && String(byAlias._id) === String(card1._id));

    // ── S7 — legacy profile URL unchanged ──
    report('S7  profile alias still resolves (no URL churn)',
      !!card1 && !!byAlias && byAlias.isActive === true && byAlias.urlAlias === card1.urlAlias);

    // ── S8 — card replacement preserves permanent identity ──
    const oldUid = card2?.cardUid ?? '';
    const newUid = freshUid();
    const replaced = card2
      ? await replaceCardForAssignment({
          card: card2 as any,
          ownerUserId: userA._id.toString(),
          newUid,
        })
      : null;
    report('S8  replacement accepted', !!replaced && replaced.ok === true);
    const c2 = card2 ? await leanCard(card2._id) : null;
    report('S8  publicSlug preserved after replacement',
      !!c2 && c2.publicSlug === `${bizBase}/linkedin-2`, `got ${c2?.publicSlug}`);
    report('S8  routeSlug/slug/urlAlias preserved',
      !!c2 && c2.routeSlug === card2?.routeSlug && c2.slug === card2?.slug && c2.urlAlias === card2?.urlAlias);
    report('S8  old UID audited in previousCardUids',
      !!c2 && Array.isArray(c2.previousCardUids) && c2.previousCardUids.includes(oldUid));
    report('S8  new cardUid applied', !!c2 && c2.cardUid === newUid.toUpperCase());

    // ── S9 — removed product: no renumbering, no re-issue ──
    if (card2) {
      await unbindAssignedCard(card2 as any);
    }
    const retreat = (await Card.findById(card2?._id).lean()) as unknown as CardSnapshot | null;
    report('S9  removed card stays offline but retains slug slot',
      !!retreat && retreat.isActive === false && retreat.publicSlug === `${bizBase}/linkedin-2`);
    const card4 = await assignCard(userA, catLinkedIn as InstanceType<typeof CatalogProduct>);
    trackCard(card4?._id);
    report('S9  new card skips removed slot → linkedin-4 (never -2)',
      card4?.publicSlug === `${bizBase}/linkedin-4`, `got ${card4?.publicSlug}`);
    const r3again = await getPublicCardByPublicSlug(`${bizBase}/linkedin-3`);
    report('S9  linkedin-3 never renumbered, still resolves to card3',
      !!card3 && !!r3again && String(r3again._id) === String(card3._id));
    const r1again = await getPublicCardByPublicSlug(`${bizBase}/linkedin`);
    report('S9  base slug unaffected', !!card1 && !!r1again && String(r1again._id) === String(card1._id));

    // ── S10 — route conflicts / reserved prefixes ──
    report('S10  reserved segments are guarded', ['admin', 'api', 'dashboard', 'profile', 'r'].every((s) => RESERVED_PUBLIC_SEGMENTS.has(s)));
    const userC = await makeUser(`humanurl-c-${stamp}@test.local`, 'Admin');
    trackUser(userC._id);
    await setCompanyName(userC._id, 'Admin');
    const cardC = await assignCard(userC, catLinkedIn as InstanceType<typeof CatalogProduct>);
    trackCard(cardC?._id);
    report('S10  "Admin" business slug never uses the reserved /admin prefix',
      !!cardC?.publicSlug && cardC.publicSlug.startsWith('admin-') && cardC.publicSlug.endsWith('/linkedin'),
      `got ${cardC?.publicSlug}`);
    const reservedSafe = cardC?.publicSlug?.split('/')[0] ?? '';
    const rC = reservedSafe ? await getPublicCardByPublicSlug(`${reservedSafe}/linkedin`) : null;
    report('S10  reserved-safe URL resolves to its own card',
      !!cardC && !!rC && String(rC._id) === String(cardC._id));
    report('S10  malformed key (no product) rejected', (await getPublicCardByPublicSlug('acme-corp')) === null);
    report('S10  malformed key (trailing slash) rejected', (await getPublicCardByPublicSlug('acme-corp/linkedin/')) === null);
    const upper = await getPublicCardByPublicSlug(`${bizBase.toUpperCase()}/LINKEDIN`);
    report('S10  resolution is case-insensitive', !!upper && String(upper._id) === String(card1?._id));

    // ── S11 — rendering reuse (shared PublicCardPage) ──
    const root = process.cwd();
    const profilePage = await readFile(path.resolve(root, 'src/app/profile/[alias]/page.tsx'), 'utf8');
    const humanPage = await readFile(path.resolve(root, 'src/app/[business]/[product]/page.tsx'), 'utf8');
    report('S11  /profile delegates to PublicCardPage', profilePage.includes('PublicCardPage'));
    report('S11  /{business}/{product} delegates to PublicCardPage', humanPage.includes('PublicCardPage'));
    report('S11  /profile no longer owns its own renderer', !/PublicVcardRenderer/.test(profilePage));

    // ── S12 — analytics/identity fields untouched ──
    const finalCard = card1 ? await leanCard(card1._id) : null;
    report(
      'S12  taps/previous UIDs untouched on the original card',
      !!finalCard &&
        (finalCard.stats as { taps?: number })?.taps === 0 &&
        Array.isArray(finalCard.previousCardUids) &&
        finalCard.previousCardUids.length === 0
    );

    // ── S13 — explicit admin URL slug at customer creation (P9-B) ──
    const slugBase = `p9b${stamp.toLowerCase()}`;
    const assignedBy = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const ex1 = await createCustomerWithProducts({
      name: 'Explicit Slug Co',
      email: `humanurl-explicit-${stamp}@test.local`,
      password: 'secret-password',
      urlSlug: slugBase,
      products: [{ catalogProductId: catInsta._id.toString(), cardUid: freshUid() }],
      assignedBy,
    });
    report(
      'S13  creation accepted with explicit urlSlug',
      ex1.ok === true,
      ex1.ok ? '' : (ex1 as { error?: string }).error ?? String((ex1 as { status?: number }).status ?? '')
    );
    type P9bView = {
      user?: { _id?: unknown; bizSlug?: unknown };
      products?: { data?: { card?: { _id?: unknown } | null } | null }[];
    };
    const ex1View = ex1.ok ? (ex1.data as P9bView) : null;
    let ex1Id: unknown = null;
    let ex1CardId: unknown = null;
    if (ex1View) {
      ex1Id = ex1View.user?._id ?? null;
      trackUser(ex1Id);
      ex1CardId = ex1View.products?.[0]?.data?.card?._id ?? null;
      if (ex1CardId) trackCard(ex1CardId);
    }
    report(
      'S13  explicit urlSlug becomes the bizSlug verbatim',
      ex1.ok && ex1View?.user?.bizSlug === slugBase,
      `got ${ex1.ok ? ex1View?.user?.bizSlug : 'creation failed'}`
    );

    const ex2 = await createCustomerWithProducts({
      name: 'Explicit Slug Co 2',
      email: `humanurl-explicit2-${stamp}@test.local`,
      password: 'secret-password',
      urlSlug: slugBase,
      products: [{ catalogProductId: catInsta._id.toString(), cardUid: freshUid() }],
      assignedBy,
    });
    const ex2View = ex2.ok ? (ex2.data as P9bView) : null;
    if (ex2View?.user?._id) {
      trackUser(ex2View.user._id);
    }
    report(
      'S13  duplicate explicit base allocated -2 by the monotonic counter',
      ex2.ok && ex2View?.user?.bizSlug === `${slugBase}-2`,
      `got ${ex2.ok ? ex2View?.user?.bizSlug : 'creation failed'}`
    );

    const ex1Card = ex1CardId ? await leanCard(ex1CardId) : null;
    report(
      'S13  card publicSlug = {explicit}/{product-slug}',
      ex1Card?.publicSlug === `${slugBase}/instagram`,
      `got ${ex1Card?.publicSlug ?? '(no card)'}`
    );

    if (ex1CardId) {
      await Card.updateOne({ _id: ex1CardId }, { $set: { cardLabel: 'Sales Team' } });
    }
    const afterLabel = ex1CardId ? await leanCard(ex1CardId) : null;
    report(
      'S13  Card.cardLabel cannot re-purpose the public URL (P9-A + P9-B isolated)',
      afterLabel?.publicSlug === `${slugBase}/instagram`,
      `got ${afterLabel?.publicSlug ?? '(no card)'}`
    );

    const autoName = `P9b Auto ${stamp}`;
    const ex3 = await createCustomerWithProducts({
      name: autoName,
      email: `humanurl-auto-${stamp}@test.local`,
      password: 'secret-password',
      products: [{ catalogProductId: catInsta._id.toString(), cardUid: freshUid() }],
      assignedBy,
    });
    const ex3View = ex3.ok ? (ex3.data as P9bView) : null;
    if (ex3View?.user?._id) {
      trackUser(ex3View.user._id);
    }
    const autoBase = generateSlug(autoName);
    report(
      'S13  no explicit urlSlug → slug still derived from the creation name',
      ex3.ok && !!ex3View?.user?.bizSlug && String(ex3View.user.bizSlug).startsWith(autoBase),
      `got ${ex3.ok ? ex3View?.user?.bizSlug : 'creation failed'}`
    );

    // ── S14 — My Products API + UI surface the human URL (P9-B) ──
    const myListRoute = await readFile(path.resolve(root, 'src/app/api/my/products/route.ts'), 'utf8');
    const myDetailRoute = await readFile(path.resolve(root, 'src/app/api/my/products/[id]/route.ts'), 'utf8');
    const myProductsPage = await readFile(path.resolve(root, 'src/app/(dashboard)/dashboard/products/page.tsx'), 'utf8');
    const humanUrlSrc = await readFile(path.resolve(root, 'src/lib/services/human-url.ts'), 'utf8');
    report('S14  my/products list selects publicSlug', myListRoute.includes('publicSlug'));
    report('S14  my/products list exposes publicUrl', myListRoute.includes('publicUrl'));
    report('S14  my/products detail selects publicSlug + publicUrl', myDetailRoute.includes('publicSlug') && myDetailRoute.includes('publicUrl'));
    report('S14  UI renders the Public URL row', myProductsPage.includes('Public URL'));
    report('S14  UI labels the /r/ value "Permanent NFC/QR route"', myProductsPage.includes('Permanent NFC/QR route'));
    report('S14  permanentRoute still serialized on both endpoints', myListRoute.includes('permanentRoute') && myDetailRoute.includes('permanentRoute'));
    report('S14  human-url allocator never depends on cardLabel', !humanUrlSrc.includes('cardLabel'));

  } finally {
    // Remove only the test fixtures we created (catalog docs are shared seeds
    // and are left in place).
    for (const cardId of trackedCardIds) {
      await Card.deleteOne({ _id: cardId }).catch(() => undefined);
    }
    for (const userId of trackedUserIds) {
      await UserProduct.deleteMany({ userId }).catch(() => undefined);
      await Profile.deleteOne({ userId }).catch(() => undefined);
      await User.deleteOne({ _id: userId }).catch(() => undefined);
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});