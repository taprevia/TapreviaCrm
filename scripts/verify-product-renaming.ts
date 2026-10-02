/**
 * verify-product-renaming.ts — HTTP-level verification for the complete product
 * renaming feature:
 *
 *   1. A custom product title is the primary label (`productTitle`) everywhere
 *      in /api/my/products (list + detail) for cards, standees AND
 *      uninstantiated (pending) card assignments.
 *   2. PATCH /api/my/products/[id] renames the backing field by instance type
 *      (Card.cardLabel / Standee.displayName / UserProduct.pendingConfig).
 *   3. An empty title resets the product to its catalog template name.
 *   4. Every rename is recorded in ProductTitleLog (previous/new title).
 *   5. The admin user-products endpoint reflects the same custom title.
 *
 * Requires a running dev/production server:
 *   MONGODB_URI=... npm run build && npm start -- -p 3101
 *   SMOKE_BASE_URL=http://localhost:3101 npx tsx scripts/verify-product-renaming.ts
 *
 * Admin credentials default to the seeded admin (scripts/seed.ts / README).
 */

import mongoose from 'mongoose';
import User from '../src/models/User';
import Card from '../src/models/Card';
import Standee from '../src/models/Standee';
import CatalogProduct from '../src/models/CatalogProduct';
import UserProduct from '../src/models/UserProduct';
import Profile from '../src/models/Profile';
import ProductTitleLog from '../src/models/ProductTitleLog';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nfc-crm';
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'admin@taprevia.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || 'admin123';

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

interface Row { productTitle?: string; assignmentId?: string; instanceType?: string | null; }

async function main() {
  await mongoose.connect(MONGODB_URI);

  const suffix = Date.now().toString(36);
  const email = `rename-${suffix}@test.local`;
  const cardUid = `RNM-A-${suffix.toUpperCase()}`;
  let customerId: string | undefined;
  let cardAssignmentId: string | undefined;
  let standeeAssignmentId: string | undefined;
  let pendingAssignmentId: string | undefined;

  try {
    const adminLogin = await request('/api/auth/login', undefined, {
      method: 'POST',
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    report('setup: admin login', adminLogin.status === 200, `status ${adminLogin.status}`);
    const adminCookie = adminLogin.setCookie;

    const reg = await request('/api/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ name: `Rename Verifier ${suffix}`, email, password: 'VerifyPass123!' }),
    });
    report('setup: register fresh customer', reg.status === 201 && !!reg.json?.user?.id, `status ${reg.status}`);
    customerId = reg.json?.user?.id as string;
    const custCookie = reg.setCookie;

    const cardCatalog = (await CatalogProduct.findOne({ category: 'card', active: true }).lean()) as unknown as { _id: unknown; name?: string };
    const standeeCatalog = (await CatalogProduct.findOne({ category: 'standee', active: true }).lean()) as unknown as { _id: unknown; name?: string };
    report('setup: card catalog product found', !!cardCatalog?._id);
    report('setup: standee catalog product found', !!standeeCatalog?._id);
    if (!cardCatalog?._id || !standeeCatalog?._id) return;

    // Card assignment (instantiated)
    const assignCard = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: cardCatalog._id.toString(), quantity: 1, cardUid }),
    });
    report('setup: assign instantiated card', assignCard.status === 201, `status ${assignCard.status}`);
    cardAssignmentId = String(assignCard.json?.userProduct?._id ?? assignCard.json?.card?._id ?? '');

    // Standee assignment
    const assignStandee = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: standeeCatalog._id.toString(), quantity: 1 }),
    });
    report('setup: assign standee', assignStandee.status === 201, `status ${assignStandee.status}`);
    standeeAssignmentId = String(assignStandee.json?.userProduct?._id ?? '');

    // Uninstantiated card assignment (no UID)
    const assignPending = await request(`/api/admin/users/${customerId}/products`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ catalogProductId: cardCatalog._id.toString(), quantity: 1 }),
    });
    report('setup: assign uninstantiated card', assignPending.status === 201, `status ${assignPending.status}`);
    pendingAssignmentId = String(assignPending.json?.userProduct?._id ?? '');

    const list = await request('/api/my/products', custCookie);
    report('list: fetch my products', list.status === 200, `status ${list.status}`);
    const rows = (list.json?.products ?? []) as Row[];

    // Pick each assignment by id — the UserProduct create returns _id.
    const cardRow = rows.find((r) => r.assignmentId === cardAssignmentId);
    const pendingRow = rows.find((r) => r.assignmentId === pendingAssignmentId);
    const standeeRow = rows.find((r) => r.assignmentId === standeeAssignmentId);
    report(
      'default: card productTitle = catalog name',
      cardRow?.productTitle === cardCatalog.name,
      `got ${JSON.stringify(cardRow?.productTitle)}`
    );
    report(
      'default: standee productTitle = catalog name (provisioning seed)',
      standeeRow?.productTitle === standeeCatalog.name,
      `got ${JSON.stringify(standeeRow?.productTitle)}`
    );
    report(
      'default: uninstantiated card productTitle = catalog name',
      pendingRow?.productTitle === cardCatalog.name,
      `got ${JSON.stringify(pendingRow?.productTitle)}`
    );

    // ── Rename the instantiated card ────────────────────────────────────────
    const renameCard = await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Reception Desk' }),
    });
    report('rename: PATCH card title', renameCard.status === 200, `status ${renameCard.status}, ${renameCard.text?.slice?.(0, 120) ?? ''}`);
    report(
      'rename: detail productTitle updated',
      renameCard.json?.product?.productTitle === 'Reception Desk',
      `got ${JSON.stringify(renameCard.json?.product?.productTitle)}`
    );

    const listAfterCard = await request('/api/my/products', custCookie);
    const cardRowAfter = (listAfterCard.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === cardAssignmentId);
    report(
      'rename: list productTitle updated',
      cardRowAfter?.productTitle === 'Reception Desk',
      `got ${JSON.stringify(cardRowAfter?.productTitle)}`
    );

    // ── Rename the standee ──────────────────────────────────────────────────
    const renameStandee = await request(`/api/my/products/${standeeAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Front Counter Standee' }),
    });
    report(
      'rename: standee title updated',
      renameStandee.status === 200 && renameStandee.json?.product?.productTitle === 'Front Counter Standee',
      `status ${renameStandee.status}, got ${JSON.stringify(renameStandee.json?.product?.productTitle)}`
    );
    const standeeDb = await Standee.findOne({ _id: (await UserProduct.findById(standeeAssignmentId).lean() as unknown as { standeeId?: unknown }).standeeId }).lean() as unknown as { displayName?: string } | null;
    report(
      'rename: standee.displayName persisted',
      standeeDb?.displayName === 'Front Counter Standee',
      `got ${JSON.stringify(standeeDb?.displayName)}`
    );
    const listAfterStandee = await request('/api/my/products', custCookie);
    const standeeRowAfter = (listAfterStandee.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === standeeAssignmentId);
    report(
      'rename: standee title in the list too',
      standeeRowAfter?.productTitle === 'Front Counter Standee',
      `got ${JSON.stringify(standeeRowAfter?.productTitle)}`
    );

    // ── Rename the uninstantiated card (pendingConfig.cardLabel) ────────────
    const renamePending = await request(`/api/my/products/${pendingAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Back Office Card' }),
    });
    report(
      'rename: uninstantiated card title updated',
      renamePending.status === 200 && renamePending.json?.product?.productTitle === 'Back Office Card',
      `status ${renamePending.status}, got ${JSON.stringify(renamePending.json?.product?.productTitle)}`
    );
    const pendingDb = await UserProduct.findById(pendingAssignmentId).lean() as unknown as { pendingConfig?: { cardLabel?: string } | null } | null;
    report(
      'rename: pendingConfig.cardLabel persisted',
      pendingDb?.pendingConfig?.cardLabel === 'Back Office Card',
      `got ${JSON.stringify(pendingDb?.pendingConfig?.cardLabel)}`
    );

    // ── Uninstantiated standee: list/detail/admin must agree ────────────────
    // A standee assignment with no bound Standee record (legacy/edge state) is
    // created directly — the PATCH route supports renaming it via
    // pendingConfig.displayName, so every reader must resolve it identically.
    const pendingStandeeCatalog = (await CatalogProduct.findOne({ category: 'standee', active: true }).lean()) as unknown as { _id: unknown; name?: string };
    const pendingStandeeUserProduct = await UserProduct.create({
      userId: customerId,
      catalogProductId: pendingStandeeCatalog._id,
      quantity: 1,
      pendingConfig: { kind: 'standee', displayName: pendingStandeeCatalog.name },
    });
    const pendingStandeeAssignmentId = String(pendingStandeeUserProduct._id);
    const listBeforePending = await request('/api/my/products', custCookie);
    const pendingStandeeRowBefore = (listBeforePending.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === pendingStandeeAssignmentId);
    report(
      'uninst-standee: list default title = catalog name',
      pendingStandeeRowBefore?.productTitle === pendingStandeeCatalog.name,
      `got ${JSON.stringify(pendingStandeeRowBefore?.productTitle)}`
    );
    const renamePendingStandee = await request(`/api/my/products/${pendingStandeeAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Front Desk Standee' }),
    });
    report(
      'uninst-standee: PATCH renames it',
      renamePendingStandee.status === 200 && renamePendingStandee.json?.product?.productTitle === 'Front Desk Standee',
      `status ${renamePendingStandee.status}, got ${JSON.stringify(renamePendingStandee.json?.product?.productTitle)}`
    );
    const listAfterPendingStandee = await request('/api/my/products', custCookie);
    const pendingStandeeRow = (listAfterPendingStandee.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === pendingStandeeAssignmentId);
    report(
      'uninst-standee: list agrees with detail',
      pendingStandeeRow?.productTitle === 'Front Desk Standee',
      `got ${JSON.stringify(pendingStandeeRow?.productTitle)}`
    );

    // ── Empty title resets to the catalog template name ─────────────────────
    const reset = await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: '   ' }),
    });
    report(
      'reset: empty title resets to template name',
      reset.status === 200 && reset.json?.product?.productTitle === cardCatalog.name,
      `status ${reset.status}, got ${JSON.stringify(reset.json?.product?.productTitle)}`
    );

    // ── Config save must PRESERVE the custom title on uninstantiated cards ──
    // B1 regression: saving a destination rebuilt pendingConfig from scratch
    // and dropped cardLabel. Save a destination, then confirm the title stands.
    const saveConfig = await request(`/api/my/products/${pendingAssignmentId}/config`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ whatsapp: { phoneNumber: '+919876543210', defaultMessage: '' } }),
    });
    report(
      'preserve: config save accepted on pending card',
      saveConfig.status === 200,
      `status ${saveConfig.status}, ${saveConfig.text?.slice?.(0, 120) ?? ''}`
    );
    const pendingDbAfterConfig = await UserProduct.findById(pendingAssignmentId).lean() as unknown as { pendingConfig?: { cardLabel?: string; whatsappConfig?: unknown } | null } | null;
    report(
      'preserve: cardLabel survives config save',
      pendingDbAfterConfig?.pendingConfig?.cardLabel === 'Back Office Card',
      `got ${JSON.stringify(pendingDbAfterConfig?.pendingConfig?.cardLabel)}`
    );
    const listAfterConfig = await request('/api/my/products', custCookie);
    const pendingRowAfterConfig = (listAfterConfig.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === pendingAssignmentId);
    report(
      'preserve: title unchanged in the list',
      pendingRowAfterConfig?.productTitle === 'Back Office Card',
      `got ${JSON.stringify(pendingRowAfterConfig?.productTitle)}`
    );

    // ── Rename survives binding a physical card (cardLabel propagation) ─────
    const bindUid = `RNM-B-${suffix.toUpperCase()}`;
    const bind = await request(`/api/admin/users/${customerId}/products/${pendingAssignmentId}/card`, adminCookie, {
      method: 'PUT',
      body: JSON.stringify({ cardUid: bindUid }),
    });
    report(
      'bind: admin binds the physical card',
      bind.status === 200 && bind.json?.linked === true,
      `status ${bind.status}, ${bind.text?.slice?.(0, 120) ?? ''}`
    );
    const boundCardId = String(bind.json?.card?._id ?? '');
    const boundCardDb = boundCardId
      ? (await Card.findById(boundCardId).lean()) as unknown as { cardLabel?: string } | null
      : null;
    report(
      'bind: cardLabel carried to the bound card',
      boundCardDb?.cardLabel === 'Back Office Card',
      `got ${JSON.stringify(boundCardDb?.cardLabel)}`
    );
    const listAfterBind = await request('/api/my/products', custCookie);
    const boundRow = (listAfterBind.json?.products ?? ([] as Row[])).find((r: Row) => r.assignmentId === pendingAssignmentId);
    report(
      'bind: title still correct after binding',
      boundRow?.productTitle === 'Back Office Card',
      `got ${JSON.stringify(boundRow?.productTitle)}`
    );

    // ── Sanitization boundaries on the bound card ───────────────────────────
    // A title past the 120-char limit is truncated (no lone surrogate); control
    // characters are stripped; internal whitespace collapses.
    const boundaryTitle = `${'a'.repeat(119)}😀${'b'.repeat(20)}`;
    const boundary = await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: boundaryTitle }),
    });
    const boundaryTitleOut: string = boundary.json?.product?.productTitle ?? '';
    const codepoints = [...boundaryTitleOut];
    report(
      'sanitize: over-limit title truncated to 120 code points',
      boundary.status === 200 && codepoints.length <= 120,
      `status ${boundary.status}, len ${codepoints.length}`
    );
    report(
      'sanitize: no lone surrogate at truncation boundary',
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(boundaryTitleOut),
      `got ${JSON.stringify(boundaryTitleOut.slice(-4))}`
    );
    const controlChars = await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Kitchen   \u0007\nDesk\u0000 Card' }),
    });
    report(
      'sanitize: control chars stripped and whitespace collapsed',
      controlChars.status === 200 && controlChars.json?.product?.productTitle === 'Kitchen Desk Card',
      `got ${JSON.stringify(controlChars.json?.product?.productTitle)}`
    );
    // Restore a clean title for the remaining checks.
    await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Reception Desk' }),
    });

    // ── Audit log ───────────────────────────────────────────────────────────
    const logs = await ProductTitleLog.find({ userId: customerId }).sort({ createdAt: 1 }).lean();
    report(
      'audit: rename events recorded (>= 4)',
      logs.length >= 4,
      `got ${logs.length}`
    );
    report(
      'audit: previous/new titles recorded',
      logs.some((l) => l.newTitle === 'Reception Desk') &&
        logs.some((l) => l.newTitle === 'Front Counter Standee') &&
        logs.some((l) => l.newTitle === 'Back Office Card') &&
        logs.some((l) => l.newTitle === cardCatalog.name && l.previousTitle === 'Reception Desk'),
      `records: ${JSON.stringify(logs.map((l) => `${l.previousTitle} → ${l.newTitle}`))}`
    );
    report(
      'audit: source is customer',
      logs.every((l) => l.source === 'customer'),
      `got ${JSON.stringify(logs.map((l) => l.source))}`
    );
    report(
      'audit: instance type populated',
      logs.every((l) => l.instanceType === 'card' || l.instanceType === 'standee'),
      `got ${JSON.stringify(logs.map((l) => l.instanceType))}`
    );

    // ── Admin products endpoint reflects the rename ─────────────────────────
    const adminList = await request(`/api/admin/users/${customerId}/products`, adminCookie);
    report('admin: fetch user products', adminList.status === 200, `status ${adminList.status}`);
    const adminProducts = (adminList.json?.products ?? []) as Array<{ _id?: string; productTitle?: string }>;
    const adminCard = adminProducts.find((p) => p._id === cardAssignmentId);
    report(
      'admin: bound card reflects its current custom title',
      adminCard?.productTitle === 'Reception Desk',
      `got ${JSON.stringify(adminCard?.productTitle)}`
    );
    const adminPending = adminProducts.find((p) => p._id === pendingAssignmentId);
    report(
      'admin: uninstantiated productTitle reflects rename',
      adminPending?.productTitle === 'Back Office Card',
      `got ${JSON.stringify(adminPending?.productTitle)}`
    );
    const adminPendingStandee = adminProducts.find((p) => p._id === pendingStandeeAssignmentId);
    report(
      'admin: uninstantiated standee title reflects rename',
      adminPendingStandee?.productTitle === 'Front Desk Standee',
      `got ${JSON.stringify(adminPendingStandee?.productTitle)}`
    );
    const adminStandee = adminProducts.find((p) => p._id === standeeAssignmentId);
    report(
      'admin: renamed standee title after explicit rename',
      adminStandee?.productTitle === 'Front Counter Standee',
      `got ${JSON.stringify(adminStandee?.productTitle)}`
    );

    // Invalid input is rejected (title only; no badge/other fields allowed).
    const badRename = await request(`/api/my/products/${cardAssignmentId}`, custCookie, {
      method: 'PATCH',
      body: JSON.stringify({ someOtherField: true }),
    });
    report(
      'validation: unknown payload rejected with 400',
      badRename.status === 400,
      `status ${badRename.status}`
    );
  } finally {
    // ── Cleanup: remove the test customer and linked records ────────────────
    if (customerId) {
      await ProductTitleLog.deleteMany({ userId: customerId }).catch(() => undefined);
      await UserProduct.deleteMany({ userId: customerId }).catch(() => undefined);
      await Card.deleteMany({ assignedUserId: customerId }).catch(() => undefined);
      await Card.deleteMany({ userId: customerId }).catch(() => undefined);
      await Standee.deleteMany({ userId: customerId }).catch(() => undefined);
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