/**
 * verify-card-label-ownership.ts — HTTP-level regression test for Card Label
 * ownership:
 *
 *   "Each card owns its own label. Renaming one card must never change another
 *    card's label, and must never rename the canonical product."
 *
 * Also verifies the defaulting behavior: a card provisioned for a purchased
 * product seeds its management label with the product name (not the user name).
 *
 * Requires a running dev/production server:
 *   MONGODB_URI=... npm run build && npm start -- -p 3101
 *   SMOKE_BASE_URL=http://localhost:3101 npx tsx scripts/verify-card-label-ownership.ts
 *
 * Admin credentials default to the seeded admin (scripts/seed.ts / README).
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import CatalogProduct from '../src/models/CatalogProduct';
import UserProduct from '../src/models/UserProduct';
import Profile from '../src/models/Profile';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'admin@taprevia.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'admin123';

interface CardSnap {
  _id?: { toString(): string } | unknown;
  name?: string | null;
  cardLabel?: string | null;
}

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
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.origin = BASE;
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: json as any, setCookie: res.headers.get('set-cookie') ?? '', text };
}

async function main() {
  await mongoose.connect(MONGODB_URI);

  const suffix = Date.now().toString(36);
  const email = `cardlabel-owner-${suffix}@test.local`;
  const uidA = `CLO-A-${suffix.toUpperCase()}`;
  const uidB = `CLO-B-${suffix.toUpperCase()}`;
  let customerId: string | undefined;
  let cardA = '';
  let cardB = '';

  try {
    // ── Setup: admin login + fresh customer + two same-product assignments ──
    const adminLogin = await request('/api/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    report('setup: admin login', adminLogin.status === 200, `status ${adminLogin.status}`);
    const adminCookie = adminLogin.setCookie;

    const reg = await request('/api/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ name: `CardLabel Owner ${suffix}`, email, password: 'VerifyPass123!' }),
    });
    report('setup: register fresh customer', reg.status === 201 && !!reg.json?.user?.id, `status ${reg.status}`);
    customerId = reg.json?.user?.id as string;
    const custCookie = reg.setCookie;

    const catalogProduct = (await CatalogProduct.findOne({ slug: 'premium-nfc-card' }).lean()) as unknown as CardSnap;
    report('setup: premium product found', !!catalogProduct, catalogProduct ? '' : 'missing premium-nfc-card');
    if (!catalogProduct || !catalogProduct._id) return;

    const assignA = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: catalogProduct._id.toString(), quantity: 1, cardUid: uidA }),
    });
    report('setup: assign card A', assignA.status === 201 && !!assignA.json?.card?._id, `status ${assignA.status}`);
    cardA = String(assignA.json?.card?._id ?? '');

    const assignB = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: catalogProduct._id.toString(), quantity: 1, cardUid: uidB }),
    });
    report('setup: assign card B', assignB.status === 201 && !!assignB.json?.card?._id, `status ${assignB.status}`);
    cardB = String(assignB.json?.card?._id ?? '');
    if (!cardA || !cardB) return;

    // ── Defaulting: new cards seed their label with the PRODUCT name ────────
    const cardARec = (await Card.findById(cardA).lean()) as unknown as CardSnap;
    const cardBRec = (await Card.findById(cardB).lean()) as unknown as CardSnap;
    report(
      'default: card A label = product name',
      cardARec?.cardLabel === catalogProduct.name,
      `got ${JSON.stringify(cardARec?.cardLabel)}`
    );
    report(
      'default: card B label = product name',
      cardBRec?.cardLabel === catalogProduct.name,
      `got ${JSON.stringify(cardBRec?.cardLabel)}`
    );

    // ── Ownership: PATCHing one card never touches the other or the product ─
    const beforeA = (await Card.findById(cardA).lean()) as unknown as CardSnap;
    const beforeB = (await Card.findById(cardB).lean()) as unknown as CardSnap;
    const beforeProd = (await CatalogProduct.findById(catalogProduct._id).lean()) as unknown as CardSnap;

    const patch = await request(`/api/cards/${cardA}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ cardLabel: 'Reception Desk' }),
    });
    report('ownership: PATCH card A label', patch.status === 200 && patch.json?.card?.cardLabel === 'Reception Desk', `status ${patch.status}`);

    const afterA = (await Card.findById(cardA).lean()) as unknown as CardSnap;
    const afterB = (await Card.findById(cardB).lean()) as unknown as CardSnap;
    const afterProd = (await CatalogProduct.findById(catalogProduct._id).lean()) as unknown as CardSnap;

    report(
      'ownership: card A label changed',
      afterA?.cardLabel === 'Reception Desk',
      `got ${JSON.stringify(afterA?.cardLabel)}`
    );
    report(
      'ownership: card B label unchanged',
      afterB?.cardLabel === beforeB?.cardLabel,
      `before ${JSON.stringify(beforeB?.cardLabel)} after ${JSON.stringify(afterB?.cardLabel)}`
    );
    report(
      'ownership: catalog product name unchanged',
      afterProd?.name === beforeProd?.name && afterProd?.name === catalogProduct.name,
      `got ${JSON.stringify(afterProd?.name)}`
    );

    // Same product still defaults identically on a fresh card later on.
    const assignC = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: catalogProduct._id.toString(), quantity: 1, cardUid: `CLO-C-${suffix.toUpperCase()}` }),
    });
    const cardC = String(assignC.json?.card?._id ?? '');
    const cardCRec = cardC ? (await Card.findById(cardC).lean()) as unknown as CardSnap : null;
    report(
      'ownership: label stays per-card (card A label not copied by new card)',
      cardC ? cardCRec?.cardLabel === catalogProduct.name : false,
      `got ${JSON.stringify(cardCRec?.cardLabel)}`
    );
  } finally {
    // ── Cleanup: remove the test customer and its linked records ────────────
    if (customerId) {
      await UserProduct.deleteMany({ userId: customerId }).catch(() => undefined);
      await Card.deleteMany({ assignedUserId: customerId }).catch(() => undefined);
      await Card.deleteMany({ userId: customerId }).catch(() => undefined);
      await Profile.deleteMany({ userId: customerId }).catch(() => undefined);
      await User.deleteOne({ _id: customerId }).catch(() => undefined);
    }
    await mongoose.disconnect();
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});