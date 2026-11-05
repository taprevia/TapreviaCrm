/**
 * Phase 4 URL safety: admin link allocation failure + ownership protection.
 *
 * Isolated only: requires MONGODB_DB to start with `taprevia_phase4_` and a
 * localhost Mongo URI. Drops only that disposable database.
 */
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User from '@/models/User';
import CatalogProduct from '@/models/CatalogProduct';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import Profile from '@/models/Profile';
import { generateToken } from '@/lib/auth';
import { connectDB } from '@/lib/db';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { replaceCardForAssignment } from '@/lib/services/card-replacement';
import { findCardByUid } from '@/lib/services/card-identity';
import { PUT as adminLinkPUT } from '@/app/api/admin/users/[id]/products/[userProductId]/card/route';

const URI = process.env.MONGODB_URI ?? '';
const DB = process.env.MONGODB_DB ?? '';
if (!URI.includes('127.0.0.1') || !DB.startsWith('taprevia_phase4_')) {
  throw new Error(`Refusing non-isolated target: ${URI} / ${DB}`);
}

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

function adminRequest(userId: string, assignmentId: string, body: unknown): NextRequest {
  const token = generateToken(userId, 'admin');
  return new NextRequest(
    `http://localhost/api/admin/users/${userId}/products/${assignmentId}/card`,
    {
      method: 'PUT',
      headers: {
        cookie: `token=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

async function main() {
  await connectDB();
  await mongoose.connection.dropDatabase();

  const admin = await User.create({
    name: 'Phase4 Admin',
    email: 'phase4-admin@local.invalid',
    passwordHash: 'phase4-pass-123',
    role: 'admin',
    status: 'active',
  });
  const customer = await User.create({
    name: 'Phase4 Customer',
    email: 'phase4-customer@local.invalid',
    passwordHash: 'phase4-pass-123',
    role: 'customer',
    status: 'active',
  });
  const other = await User.create({
    name: 'Phase4 Other',
    email: 'phase4-other@local.invalid',
    passwordHash: 'phase4-pass-123',
    role: 'customer',
    status: 'active',
  });

  // ── Admin authentication/authorization ──────────────────────────────────
  {
    const params = {
      id: customer._id.toString(),
      userProductId: new mongoose.Types.ObjectId().toString(),
    };
    const url = `http://localhost/api/admin/users/${params.id}/products/${params.userProductId}/card`;
    const unauth = await adminLinkPUT(
      new NextRequest(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardUid: 'PHASE4-AUTH' }),
      }),
      { params }
    );
    check('AUTH unauthenticated admin request is rejected', unauth.status === 401, `status=${unauth.status}`);

    const customerToken = generateToken(customer._id.toString(), 'customer');
    const forbidden = await adminLinkPUT(
      new NextRequest(url, {
        method: 'PUT',
        headers: {
          cookie: `token=${customerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ cardUid: 'PHASE4-AUTH' }),
      }),
      { params }
    );
    check('AUTH customer cannot use admin card-link endpoint', forbidden.status === 403, `status=${forbidden.status}`);
  }

  const unmapped = await CatalogProduct.create({
    name: 'Unmapped Card Product',
    slug: `unmapped-card-${Date.now()}`,
    category: 'card',
    kind: 'profile',
    active: true,
    priceMinor: 0,
  });
  const otherProduct = await CatalogProduct.create({
    name: 'Business NFC Card',
    slug: 'business-nfc-card',
    category: 'card',
    kind: 'profile',
    active: true,
    priceMinor: 0,
  });

  // Unrelated records that must remain untouched.
  await Profile.create({ userId: other._id, personalInfo: { fullName: 'Other Person' } });
  const unrelatedCard = await Card.create({
    cardUid: 'PHASE4-UNRELATED',
    slug: `phase4-unrelated-${Date.now()}`,
    userId: other._id,
    assignedUserId: other._id,
    status: 'active',
    isActive: true,
    kind: 'profile',
    routeSlug: `phase4-unrelated-route-${Date.now()}`,
    uid: `phase4-unrelated-route-${Date.now()}`,
  });
  const unrelatedBefore = unrelatedCard.toObject();

  const pending = async (catalogId: mongoose.Types.ObjectId, label: string) =>
    UserProduct.create({
      userId: customer._id,
      catalogProductId: catalogId,
      cardId: null,
      quantity: 1,
      unitPriceMinor: 0,
      status: 'active',
      pendingConfig: {
        cardLabel: label,
        redirectUrl: 'https://example.test/pending-redirect',
        reviewAssistant: {
          enabled: true,
          googleReviewUrl: 'https://example.test/pending-review',
        },
      },
      assignedBy: admin._id,
    });

  // ── A1: newly created card + allocation failure ─────────────────────────
  {
    const assignment = await pending(unmapped._id, 'Fresh Created');
    const beforeUsers = await User.countDocuments();
    const beforeCards = await Card.countDocuments();
    const beforeProducts = await UserProduct.countDocuments();
    const response = await adminLinkPUT(
      adminRequest(admin._id.toString(), assignment._id.toString(), {
        cardUid: 'PHASE4-FRESH',
      }),
      { params: { id: customer._id.toString(), userProductId: assignment._id.toString() } }
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    check('A1 allocation failure returns an error', response.status >= 400, `status=${response.status}`);
    check('A1 never returns linked:true on failure', body?.linked !== true, JSON.stringify(body));
    const afterAssignment = await UserProduct.findById(assignment._id).lean<any>();
    check(
      'A1 assignment remains unlinked after failure',
      !afterAssignment?.cardId,
      `cardId=${String(afterAssignment?.cardId ?? '')}`
    );
    check(
      'A1 pending configuration restored',
      afterAssignment?.pendingConfig?.cardLabel === 'Fresh Created',
      JSON.stringify(afterAssignment?.pendingConfig)
    );
    check('A1 no new user created', (await User.countDocuments()) === beforeUsers, 'user count');
    check('A1 no stray card', (await Card.countDocuments()) === beforeCards, 'card count');
    check('A1 no stray assignment', (await UserProduct.countDocuments()) === beforeProducts, 'assignment count');
    check('A1 fresh card rolled back', (await Card.findOne({ cardUid: 'PHASE4-FRESH' })) === null, 'fresh card');
  }

  // ── A2: existing owned card + allocation failure ────────────────────────
  const owned = await Card.create({
    cardUid: 'PHASE4-OWNED',
    slug: `phase4-owned-${Date.now()}`,
    userId: customer._id,
    assignedUserId: customer._id,
    status: 'active',
    isActive: true,
    kind: 'profile',
    name: 'Owned Before',
    cardLabel: 'Owned Label Before',
    redirectUrl: 'https://example.test/owned-before',
    reviewAssistant: { enabled: true, googleReviewUrl: 'https://example.test/owned-review' },
    routeSlug: `phase4-owned-route-${Date.now()}`,
    uid: `phase4-owned-route-${Date.now()}`,
  });
  const ownedBefore = owned.toObject();
  {
    const assignment = await pending(unmapped._id, 'Owned Replacement');
    const response = await adminLinkPUT(
      adminRequest(admin._id.toString(), assignment._id.toString(), {
        cardUid: 'PHASE4-OWNED',
      }),
      { params: { id: customer._id.toString(), userProductId: assignment._id.toString() } }
    );
    check('A2 owned-card allocation failure returns error', response.status >= 400, `status=${response.status}`);
    const after = await Card.findById(owned._id).lean<any>();
    check('A2 owner preserved', String(after?.userId) === String(customer._id), String(after?.userId));
    check('A2 assigned holder preserved', String(after?.assignedUserId) === String(customer._id), String(after?.assignedUserId));
    check('A2 status/isActive preserved', after?.status === 'active' && after?.isActive === true, `${after?.status}/${after?.isActive}`);
    check('A2 kind preserved', after?.kind === ownedBefore.kind, `${ownedBefore.kind} -> ${after?.kind}`);
    check('A2 name preserved', after?.name === ownedBefore.name, `${ownedBefore.name} -> ${after?.name}`);
    check('A2 cardLabel preserved', after?.cardLabel === ownedBefore.cardLabel, `${ownedBefore.cardLabel} -> ${after?.cardLabel}`);
    check('A2 redirectUrl preserved', after?.redirectUrl === ownedBefore.redirectUrl, `${ownedBefore.redirectUrl} -> ${after?.redirectUrl}`);
    check(
      'A2 reviewAssistant preserved',
      JSON.stringify(after?.reviewAssistant) === JSON.stringify(ownedBefore.reviewAssistant),
      'reviewAssistant'
    );
    check('A2 publicSlug preserved', after?.publicSlug === ownedBefore.publicSlug, `${ownedBefore.publicSlug} -> ${after?.publicSlug}`);
    check('A2 identifiers preserved', after?.routeSlug === ownedBefore.routeSlug && after?.uid === ownedBefore.uid, 'route/uid');
  }

  // ── A3: newly claimed unassigned inventory + allocation failure ─────────
  {
    await Card.create({
      cardUid: 'PHASE4-INVENTORY',
      slug: `phase4-inventory-${Date.now()}`,
      userId: null,
      assignedUserId: null,
      status: 'unassigned',
      isActive: false,
      kind: 'profile',
      routeSlug: `phase4-inventory-route-${Date.now()}`,
      uid: `phase4-inventory-route-${Date.now()}`,
    });
    const assignment = await pending(unmapped._id, 'Inventory Claim');
    const response = await adminLinkPUT(
      adminRequest(admin._id.toString(), assignment._id.toString(), {
        cardUid: 'PHASE4-INVENTORY',
      }),
      { params: { id: customer._id.toString(), userProductId: assignment._id.toString() } }
    );
    check('A3 inventory allocation failure returns error', response.status >= 400, `status=${response.status}`);
    const after = await Card.findOne({ cardUid: 'PHASE4-INVENTORY' }).lean<any>();
    check('A3 inventory exists', Boolean(after), 'card');
    check('A3 inventory released', after?.assignedUserId == null && after?.userId == null, `${after?.assignedUserId}/${after?.userId}`);
    check('A3 inventory inactive', after?.status === 'unassigned' && after?.isActive === false, `${after?.status}/${after?.isActive}`);
    check('A3 inventory kind reset', after?.kind === 'profile', String(after?.kind));
  }

  // ── A4: retry succeeds after failure condition is removed ───────────────
  {
    await CatalogProduct.updateOne(
      { _id: unmapped._id },
      { $set: { slug: 'premium-nfc-card' } }
    );
    const assignment = await pending(unmapped._id, 'Retry Success');
    const response = await adminLinkPUT(
      adminRequest(admin._id.toString(), assignment._id.toString(), {
        cardUid: 'PHASE4-RETRY',
      }),
      { params: { id: customer._id.toString(), userProductId: assignment._id.toString() } }
    );
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    check('A4 retry succeeds', response.status === 200 && body?.linked === true, `status=${response.status}`);
    const card = await Card.findOne({ cardUid: 'PHASE4-RETRY' }).lean<any>();
    check('A4 retry card has publicSlug', Boolean(card?.publicSlug), String(card?.publicSlug));
    const afterAssignment = await UserProduct.findById(assignment._id).lean<any>();
    check('A4 retry assignment linked', Boolean(afterAssignment?.cardId), String(afterAssignment?.cardId));
  }

  // ── D1: cross-owner assignment rejected ─────────────────────────────────
  {
    const result = await assignUserProduct({
      user: other,
      catalogItem: otherProduct,
      quantity: 1,
      cardUid: 'PHASE4-OWNED',
      assignedBy: admin._id,
    });
    check('D1 cross-owner assignment rejected', !result.ok && result.status === 409, result.ok ? 'unexpected success' : String(result.status));
    const card = await Card.findById(owned._id).lean<any>();
    check('D1 original owner unchanged', String(card?.userId) === String(customer._id), String(card?.userId));
  }

  // ── D2: same-owner replacement preserves identifiers ───────────────────
  {
    const card = await Card.findById(owned._id);
    assert.ok(card);
    const result = await replaceCardForAssignment({
      card,
      ownerUserId: customer._id.toString(),
      newUid: 'PHASE4-OWNED-REPLACED',
    });
    check('D2 same-owner replacement succeeds', result.ok, result.ok ? 'ok' : result.error);
    const after = await Card.findById(owned._id).lean<any>();
    check('D2 routeSlug preserved', after?.routeSlug === ownedBefore.routeSlug, `${ownedBefore.routeSlug} -> ${after?.routeSlug}`);
    check('D2 publicSlug preserved', after?.publicSlug === ownedBefore.publicSlug, 'publicSlug');
    check('D2 previous UID recorded', (after?.previousCardUids ?? []).includes('PHASE4-OWNED'), JSON.stringify(after?.previousCardUids));
  }

  // ── D3: never-assigned inventory can be assigned ────────────────────────
  {
    const inventory = await Card.create({
      cardUid: 'PHASE4-NEW-INVENTORY',
      slug: `phase4-new-inventory-${Date.now()}`,
      userId: null,
      assignedUserId: null,
      status: 'unassigned',
      isActive: false,
      kind: 'profile',
      routeSlug: `phase4-new-inventory-route-${Date.now()}`,
      uid: `phase4-new-inventory-route-${Date.now()}`,
    });
    const result = await assignUserProduct({
      user: other,
      catalogItem: otherProduct,
      quantity: 1,
      cardUid: 'PHASE4-NEW-INVENTORY',
      assignedBy: admin._id,
    });
    check('D3 fresh inventory assignable', result.ok, result.ok ? 'ok' : result.error);
    const after = await Card.findById(inventory._id).lean<any>();
    check('D3 inventory now owned', String(after?.userId) === String(other._id), String(after?.userId));
    check('D3 inventory publicSlug allocated', Boolean(after?.publicSlug), String(after?.publicSlug));
  }

  // ── D4: historical-unbound limitation (reported, not fixed) ─────────────
  {
    const unbound = await Card.create({
      cardUid: 'PHASE4-OLD-UNBOUND',
      slug: `phase4-old-unbound-${Date.now()}`,
      userId: null,
      assignedUserId: null,
      status: 'unassigned',
      isActive: false,
      kind: 'profile',
      routeSlug: `phase4-old-unbound-route-${Date.now()}`,
      uid: `phase4-old-unbound-route-${Date.now()}`,
      publicSlug: `phase4-old-biz/business-card`,
    });
    const result = await assignUserProduct({
      user: customer,
      catalogItem: otherProduct,
      quantity: 1,
      cardUid: 'PHASE4-OLD-UNBOUND',
      assignedBy: admin._id,
    });
    check(
      'D4 historical-unbound reuse currently succeeds (known limitation)',
      result.ok,
      result.ok ? 'claimed' : result.error
    );
    const after = await Card.findById(unbound._id).lean<any>();
    check(
      'D4 old publicSlug is retained after reuse (known limitation)',
      after?.publicSlug === 'phase4-old-biz/business-card',
      String(after?.publicSlug)
    );
  }

  // ── A5: unrelated records unchanged ─────────────────────────────────────
  {
    const after = await Card.findById(unrelatedCard._id).lean<any>();
    const fields = ['userId', 'assignedUserId', 'status', 'isActive', 'kind', 'routeSlug', 'uid', 'slug'];
    check(
      'A5 unrelated card unchanged',
      fields.every((field) => String(after?.[field] ?? '') === String(unrelatedBefore[field] ?? '')),
      'unrelated card'
    );
    check(
      'A5 unrelated profile unchanged',
      (await Profile.countDocuments({ userId: other._id })) === 1,
      'profile count'
    );
    check(
      'A5 unrelated customer exists',
      Boolean(await User.findById(other._id)),
      'other user'
    );
  }

  const passed = results.filter((result) => result.pass).length;
  console.log(`\n=== PHASE 4 URL SAFETY: ADMIN + OWNERSHIP ===`);
  console.log(JSON.stringify({ checks: results.length, passed, failed: results.length - passed, failures: results.filter((r) => !r.pass) }, null, 2));
  await mongoose.disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
