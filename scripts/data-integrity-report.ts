/**
 * Data integrity report for the NFC Card binding model.
 *
 * Guards the invariants introduced by the "no inventory" workflow:
 *   1. Every cardUid is stored normalized (trimmed, uppercase) — the DATABASE
 *      itself must hold normalized values, not just writes through the API.
 *   2. No case-insensitive duplicate UIDs (one physical NFC UID → one Card doc).
 *   3. Cards are either bound to a real customer or unbound ("pool").
 *   4. Every UserProduct with a cardId points at a Card owned by the same user.
 *   5. Every active card record has a permanent routeSlug.
 *
 * Read-only + idempotent. Exit code 0 = clean, 1 = violations found.
 * Run with: npm run integrity
 */

import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import User from '@/models/User';
import UserProduct from '@/models/UserProduct';
import CatalogProduct from '@/models/CatalogProduct';

function report(label: string, value: number): void {
  console.log(`${label.padEnd(58)} ${value}`);
}

async function main(): Promise<void> {
  await connectDB();

  console.log('═ Data integrity report — Card binding model ═\n');

  // ─── Cards ────────────────────────────────────────────────────────────
  const totalCards = await Card.countDocuments();
  const unassigned = await Card.countDocuments({ assignedUserId: null });
  const assigned = await Card.countDocuments({ assignedUserId: { $ne: null } });
  const active = await Card.countDocuments({ status: 'active' });
  const suspended = await Card.countDocuments({ status: 'suspended' });
  const withoutRouteSlug = await Card.countDocuments({
    $or: [{ routeSlug: null }, { routeSlug: '' }, { routeSlug: { $exists: false } }],
  });

  // Non-normalized cardUids (not trim+uppercase themselves) — detected in the
  // loop below against `trim().toUpperCase()`.
  const allCards = await Card.find({}, 'cardUid')
    .lean<Array<{ _id: string; cardUid: string }>>();

  let mixedCase = 0;
  for (const c of allCards) {
    if (typeof c.cardUid !== 'string') {
      mixedCase += 1;
      continue;
    }
    if (c.cardUid !== c.cardUid.trim().toUpperCase()) mixedCase += 1;
  }

  // Case-insensitive duplicate groups.
  const uidGroups = new Map<string, Array<{ _id: string; cardUid: string }>>();
  for (const c of allCards) {
    const key = (c.cardUid ?? '').trim().toUpperCase();
    if (!key) continue;
    const list = uidGroups.get(key) ?? [];
    list.push(c);
    uidGroups.set(key, list);
  }
  const duplicateGroups = [...uidGroups.values()].filter((list) => list.length > 1);
  const duplicateUidCount = duplicateGroups.reduce((sum, list) => sum + list.length, 0);

  // Cards assigned to a user that no longer exists.
  const assignedCards = await Card.find(
    { assignedUserId: { $ne: null } },
    'assignedUserId'
  ).lean<Array<{ assignedUserId: { toString: () => string } | null }>>();
  const ownerIds = [...new Set(assignedCards.map((c) => c.assignedUserId!.toString()))];
  const existingUsers = ownerIds.length
    ? new Set(
        (
          await User.find({ _id: { $in: ownerIds } }, '_id').lean<Array<{ _id: string }>>()
        ).map((u) => u._id.toString())
      )
    : new Set<string>();
  const cardsWithMissingUser = assignedCards.filter((c) => !existingUsers.has(c.assignedUserId!.toString())).length;

  // Product records whose card exists but is owned by a DIFFERENT user.
  // (Missing card docs are reported separately as an advisory.)
  const productsForCards = await UserProduct.find(
    { cardId: { $ne: null } },
    'userId cardId status catalogProductId'
  ).lean<Array<{
    userId: { toString: () => string } | null;
    cardId: { toString: () => string } | null;
    catalogProductId: { toString: () => string } | null;
    status: string;
  }>>();
  const mismatchFlags = await Promise.all(
    productsForCards
      .filter((p) => p.cardId && p.userId)
      .map(async (p) => {
        const card = await Card.exists({ _id: p.cardId });
        if (!card) return false;
        return !(await Card.exists({
          _id: p.cardId,
          $or: [{ assignedUserId: p.userId }, { userId: p.userId }],
        }));
      })
  );
  const mismatchedProducts = productsForCards.filter(
    (p, i) => p.cardId && p.userId && mismatchFlags[i]
  );
  const ownershipMismatch = mismatchedProducts.length;
  // Soft-removed ProductRecords are expected to outlive an unbound card — only
  // ACTIVE bindings pointing at another customer's card are hard violations.
  const ownershipMismatchActive = mismatchedProducts.filter((p) => p.status === 'active').length;

  console.log('— Cards —');
  report('total cards', totalCards);
  report('bound (assignedUserId set)', assigned);
  report('unbound pool (assignedUserId null)', unassigned);
  report('status active', active);
  report('status suspended', suspended);
  report('cards missing permanent routeSlug', withoutRouteSlug);
  report('cards with non-normalized cardUid', mixedCase);
  report('case-insensitive duplicate UID groups', duplicateGroups.length);
  report('card records inside duplicate groups', duplicateUidCount);
  report('cards assigned to a missing user', cardsWithMissingUser);
  report('product↔card ownership mismatches (all statuses)', ownershipMismatch);
  report('  ↳ active bindings to another customer\'s card (hard)', ownershipMismatchActive);

  // ─── Users / UserProducts ─────────────────────────────────────────────
  const totalUserProducts = await UserProduct.countDocuments();
  const activeUserProducts = await UserProduct.countDocuments({ status: 'active' });
  const productsWithMissingCard = await UserProduct.countDocuments({ cardId: null });
  // P9 identity invariants: every customer gets a permanent customer id at
  // creation (hard), and a company profile slug (advisory — derived lazily on
  // first card allocation / by backfill). The customerId invariant is RED until
  // scripts/backfill-customer-identities.ts has run on a pre-P9 database.
  const customersWithoutCustomerId = await User.countDocuments({
    role: 'customer',
    $or: [{ customerId: null }, { customerId: '' }, { customerId: { $exists: false } }],
  });
  const customersWithoutBizSlug = await User.countDocuments({
    role: 'customer',
    $or: [{ bizSlug: null }, { bizSlug: '' }, { bizSlug: { $exists: false } }],
  });
  console.log('\n— Users / UserProducts —');
  report('total users', await User.countDocuments());
  report('customers', await User.countDocuments({ role: 'customer' }));
  report('customers missing customerId (hard, pre-backfill)', customersWithoutCustomerId);
  report('customers missing business profile slug (advisory)', customersWithoutBizSlug);
  report('total UserProducts', totalUserProducts);
  report('active UserProducts', activeUserProducts);
  report('UserProducts without a physical card (cardId null)', productsWithMissingCard);
  report(
    'UserProducts whose card doc is missing',
    (
      await Promise.all(
        productsForCards.map(async (p) => {
          if (!p.cardId) return false;
          return !(await Card.exists({ _id: p.cardId }));
        })
      )
    ).filter(Boolean).length
  );

  // ─── Catalog coherence ────────────────────────────────────────────────
  const productCatalogIds = productsForCards.map((p) => p.catalogProductId).filter(Boolean) as Array<{
    toString: () => string;
  }>;
  const existingProducts = productCatalogIds.length
    ? new Set(
        (
          await CatalogProduct.find({ _id: { $in: productCatalogIds } }, '_id').lean<Array<{ _id: string }>>()
        ).map((p) => p._id.toString())
      )
    : new Set<string>();
  const userProductsWithGhostCatalog = productCatalogIds.filter(
    (id) => !existingProducts.has(id.toString())
  ).length;
  console.log('\n— Catalog coherence —');
  report('UserProducts referencing a missing catalog product', userProductsWithGhostCatalog);

  // ─── Verdict ──────────────────────────────────────────────────────────
  const violated =
    withoutRouteSlug > 0 ||
    mixedCase > 0 ||
    duplicateGroups.length > 0 ||
    cardsWithMissingUser > 0 ||
    ownershipMismatchActive > 0 ||
    userProductsWithGhostCatalog > 0 ||
    customersWithoutCustomerId > 0;

  console.log('\n' + (violated ? '✗ VIOLATIONS FOUND (see above)' : '✓ ALL INVARIANTS HOLD'));
  process.exit(violated ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});