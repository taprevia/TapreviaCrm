/**
 * Lifecycle tests for the no-inventory Card binding flow.
 *
 * Exercises the service layer end-to-end against a real (local) MongoDB:
 *   - customer creation binds a physical card by UID directly (no inventory)
 *   - UID normalization (lowercase input stored uppercase)
 *   - duplicate UID across customers is rejected
 *   - missing UID for a card product is rejected
 *   - non-card products need no UID
 *   - mixed standee + card customer creation
 *   - card replacement preserves route + ownership, updates UID + audit trail
 *   - rollback: a failed product in a multi-product creation leaves NO records
 *
 * Run with: npm run test:cards (requires local MongoDB)
 */

import { connectDB } from '@/lib/db';
import mongoose from 'mongoose';
import User from '@/models/User';
import Card from '@/models/Card';
import UserProduct from '@/models/UserProduct';
import Profile from '@/models/Profile';
import Standee from '@/models/Standee';
import CatalogProduct from '@/models/CatalogProduct';
import { createCustomerWithProducts } from '@/lib/services/customer-creation';
import { replaceCardForAssignment } from '@/lib/services/card-replacement';
import { assignUserProduct } from '@/lib/services/user-product-assignment';

let passed = 0;
let failed = 0;
const failures: string[] = [];

interface CreatedCustomerData {
  user: { _id: string; name: string; email: string; role: string; status: string };
  products: Array<{
    card?: { _id: string; cardUid: string; slug: string };
    standee?: unknown;
  }>;
  cardCount: number;
  standeeCount: number;
}

/** Narrow the loosely-typed service result `data` to a known shape. */
const asCreated = (data: Record<string, unknown>): CreatedCustomerData =>
  data as unknown as CreatedCustomerData;

const _user = (res: { data: Record<string, unknown> }) => {
  const u = asCreated(res.data).user;
  return { ...u, _id: String(u._id) };
};
const created = (res: { data: Record<string, unknown> }) => asCreated(res.data);

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

/** Find an active card-category catalog product; skip if none exists (seeded). */
async function findCardProduct(): Promise<InstanceType<typeof CatalogProduct> | null> {
  return CatalogProduct.findOne({ category: 'card', kind: 'profile', active: true }).lean();
}

async function findStandeeProduct(): Promise<InstanceType<typeof CatalogProduct> | null> {
  return CatalogProduct.findOne({ category: 'standee', active: true }).lean();
}

const uid = () => `TST${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
const email = (tag: string) => `cards-${tag}-${Date.now()}@example.test`;

/** UserProduct.assignedBy requires a real ObjectId ref (matches the API passing admin._id). */
const ADMIN_ID = new mongoose.Types.ObjectId().toString();

async function main(): Promise<void> {
  await connectDB();

  const cardProduct = await findCardProduct();
  if (!cardProduct) {
    console.log('SKIPPED: no card-category catalog product seeded — run npm run seed first.');
    process.exit(0);
  }
  const standeeProduct = await findStandeeProduct();

  const createdUsers: string[] = [];
  const cleanup = async () => {
    for (const id of createdUsers) {
      await UserProduct.deleteMany({ userId: id });
      await Card.deleteMany({ userId: id, _id: { $in: (await Card.find({ assignedUserId: id, userId: id }).select('_id').lean()).map((c) => c._id) } });
      await Standee.deleteMany({ userId: id });
      await Profile.deleteOne({ userId: id });
      await User.deleteOne({ _id: id });
    }
  };

  console.log('\n── 1. Direct card binding at customer creation (no inventory) ──');
  {
    const testUid = uid();
    const res = await createCustomerWithProducts({
      name: 'Card Direct',
      email: email('direct'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: testUid }],
      assignedBy: ADMIN_ID,
    });
    check('creation succeeds', res.ok, res.ok ? undefined : res);
    if (res.ok) {
      createdUsers.push(_user(res)._id as string);
      const card = await Card.findOne({ cardUid: testUid });
      check('card record created from scratch', !!card);
      check('card bound to the new user', !!card && card.assignedUserId?.toString() === _user(res)._id);
      check('card is active', !!card && card.status === 'active' && card.isActive === true);
      check('kind matches the allocated product experience', !!card && card.kind === cardProduct.kind);
      check('permanent routeSlug generated', !!card && !!card.routeSlug);
    }
  }

  console.log('\n── 2. UID normalization (lowercase accepted) ──');
  {
    const testUid = uid().toLowerCase();
    const res = await createCustomerWithProducts({
      name: 'Card Norm',
      email: email('norm'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: testUid }],
      assignedBy: ADMIN_ID,
    });
    check('creation succeeds with lowercase UID', res.ok, res.ok ? undefined : res);
    if (res.ok) {
      createdUsers.push(_user(res)._id as string);
      const card = await Card.findOne({ cardUid: testUid.toUpperCase() });
      check('card stored with UPPERCASE UID', !!card);
    }
  }

  console.log('\n── 3. Duplicate UID across customers is rejected ──');
  {
    const shared = uid();
    const first = await createCustomerWithProducts({
      name: 'Owner One',
      email: email('dup1'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: shared }],
      assignedBy: ADMIN_ID,
    });
    check('first owner creation succeeds', first.ok, first.ok ? undefined : first);
    if (first.ok) createdUsers.push(_user(first)._id as string);

    const second = await createCustomerWithProducts({
      name: 'Owner Two',
      email: email('dup2'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: shared.toLowerCase() }],
      assignedBy: ADMIN_ID,
    });
    check('second owner rejected with 409 (case-insensitive)', !second.ok && second.status === 409, second);
    if (!first.ok) {
      const ghost = await User.findOne({ email: email('dup1') });
      if (ghost) createdUsers.push(ghost._id as unknown as string);
    }
  }

  console.log('\n── 4. Missing UID for a card product is rejected (nothing created) ──');
  {
    const res = await createCustomerWithProducts({
      name: 'No UID',
      email: email('nocard'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString() }],
      assignedBy: ADMIN_ID,
    });
    check('rejected with 400', !res.ok && res.status === 400, res);
    const ghost = await User.findOne({ email: email('nocard') });
    check('no user left behind (rollback / preflight)', !ghost);
  }

  console.log('\n── 5. Duplicate UID within one request is rejected ──');
  {
    const dupWithin = uid();
    const res = await createCustomerWithProducts({
      name: 'Dup Within',
      email: email('within'),
      password: 'test-pass-123',
      products: [
        { catalogProductId: cardProduct._id.toString(), cardUid: dupWithin },
        { catalogProductId: cardProduct._id.toString(), cardUid: dupWithin.toUpperCase() },
      ],
      assignedBy: ADMIN_ID,
    });
    check('rejected with 409', !res.ok && res.status === 409, res);
  }

  console.log('\n── 6. Standee product needs no Card UID ──');
  {
    if (standeeProduct) {
      const res = await createCustomerWithProducts({
        name: 'Standee Only',
        email: email('standee'),
        password: 'test-pass-123',
        products: [{ catalogProductId: standeeProduct._id.toString() }],
        assignedBy: ADMIN_ID,
      });
      check('creation succeeds with no UID', res.ok, res.ok ? undefined : res);
      if (res.ok) {
        createdUsers.push(_user(res)._id as string);
        const userProd = await UserProduct.findOne({ userId: _user(res)._id, standeeId: { $ne: null } });
        check('standee record created', !!userProd);
      }
    } else {
      console.log('  (no standee catalog product seeded — skipped)');
    }
  }

  console.log('\n── 7. Mixed card + non-card products in one creation ──');
  {
    const mixed = await createCustomerWithProducts({
      name: 'Mixed Buyer',
      email: email('mixed'),
      password: 'test-pass-123',
      products: [
        { catalogProductId: cardProduct._id.toString(), cardUid: uid() },
        ...(standeeProduct
          ? [{ catalogProductId: standeeProduct._id.toString() }]
          : []),
      ],
      assignedBy: ADMIN_ID,
    });
    check('creation succeeds', mixed.ok, mixed.ok ? undefined : mixed);
    if (mixed.ok) {
      createdUsers.push(_user(mixed)._id as string);
      check('cardCount=1', created(mixed).cardCount === 1, created(mixed).cardCount);
      if (standeeProduct) check('standeeCount=1', created(mixed).standeeCount === 1, created(mixed).standeeCount);
    }
  }

  console.log('\n── 8. Rollback — a commit-phase failure leaves NO records behind ──');
  {
    // A catalog product that passes preflight (category 'card' + a UID) but is
    // rejected during allocation because kind 'standee' cannot be bound to a
    // Card → exercises the compensating rollback for the product that
    // committed BEFORE the failure.
    const bogus = await CatalogProduct.create({
      name: 'Card-kind-mismatch (test)',
      slug: `tst-card-standee-${Date.now()}`,
      category: 'card',
      kind: 'standee',
      priceMinor: 1,
      active: true,
    });

    const beforeUsers = await User.countDocuments();
    const beforeCards = await Card.countDocuments();
    const beforeProducts = await UserProduct.countDocuments();
    const saleUid = uid();
    const res = await createCustomerWithProducts({
      name: 'Rollback Test',
      email: email('rollback'),
      password: 'test-pass-123',
      products: [
        // Valid card product — its card + UserProduct MUST be compensated.
        { catalogProductId: cardProduct._id.toString(), cardUid: saleUid },
        // Passes preflight, fails during allocation (kind/commit phase).
        { catalogProductId: bogus._id.toString(), cardUid: uid() },
      ],
      assignedBy: ADMIN_ID,
    });
    check('creation fails', !res.ok, res);
    check('failure surfaces a meaningful error', !res.ok && res.status === 400, res);
    check('no new user persisted', (await User.countDocuments()) === beforeUsers);
    check('no stray card persisted', (await Card.countDocuments()) === beforeCards);
    check('no stray UserProduct persisted', (await UserProduct.countDocuments()) === beforeProducts);
    check('valid-product card rolled back too', !(await Card.findOne({ cardUid: saleUid })));

    await bogus.deleteOne();
  }

  console.log('\n── 9. Card replacement preserves route + ownership + audit trail ──');
  {
    const res = await createCustomerWithProducts({
      name: 'Replace Me',
      email: email('replace'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: uid() }],
      assignedBy: ADMIN_ID,
    });
    check('creation succeeds', res.ok, res.ok ? undefined : res);
    if (res.ok) {
      createdUsers.push(_user(res)._id as string);
      const userProduct = created(res).products[0] as { card?: InstanceType<typeof Card> };
      const cardDoc = userProduct.card;
      check('card present in result', !!cardDoc);
      if (cardDoc) {
        const before = { uid: cardDoc.cardUid, routeSlug: cardDoc.routeSlug, owner: cardDoc.assignedUserId?.toString() };
        const newUid = uid();
        const replaced = await replaceCardForAssignment({
          card: (await Card.findById(cardDoc._id))!,
          ownerUserId: _user(res)._id as string,
          newUid: newUid.toLowerCase(),
        });
        check('replacement succeeds', replaced.ok, replaced.ok ? undefined : replaced);
        if (replaced.ok) {
          const after = await Card.findById(cardDoc._id);
          check('cardUid updated (normalized)', !!after && after.cardUid === newUid.toUpperCase(), after?.cardUid);
          check('permanent routeSlug preserved', !!after && after.routeSlug === before.routeSlug, { before, after: after?.routeSlug });
          check('owner preserved', !!after && after.assignedUserId?.toString() === before.owner, after?.assignedUserId);
          check('old UID recorded in previousCardUids', !!after && after.previousCardUids?.includes(before.uid), after?.previousCardUids);
          // Re-using the OLD uid must now be rejected for another customer.
          const newOwner = await createCustomerWithProducts({
            name: 'Old UID Try',
            email: email('olduid'),
            password: 'test-pass-123',
            products: [{ catalogProductId: cardProduct._id.toString(), cardUid: before.uid }],
            assignedBy: ADMIN_ID,
          });
          check('old UID cannot be rebound to another customer (409)', !newOwner.ok && newOwner.status === 409, newOwner);
        }
      }
    }
  }

  console.log('\n── 10. assignUserProduct (existing customer + per-product assign) ──');
  {
    const pend = await createCustomerWithProducts({
      name: 'Assign Later',
      email: email('assignlater'),
      password: 'test-pass-123',
      products: [{ catalogProductId: cardProduct._id.toString(), cardUid: uid() }],
      assignedBy: ADMIN_ID,
    });
    if (pend.ok) {
      createdUsers.push(_user(pend)._id as string);
      const user = await User.findById(_user(pend)._id);
      const soldAgain = await assignUserProduct({
        user,
        catalogItem: (await CatalogProduct.findById(cardProduct._id))!,
        quantity: 1,
        cardUid: uid(),
        assignedBy: ADMIN_ID,
        material: 'pvc',
      });
      check('second assignment succeeds with a fresh UID', soldAgain.ok, soldAgain.ok ? undefined : soldAgain);
      const bounced = await assignUserProduct({
        user,
        catalogItem: (await CatalogProduct.findById(cardProduct._id))!,
        quantity: 1,
        cardUid: (await Card.findOne({ assignedUserId: { $ne: null } }))?.cardUid ?? '',
        assignedBy: ADMIN_ID,
        material: 'pvc',
      });
      check('a UID owned by another user is rejected (409)', !bounced.ok && bounced.status === 409, bounced);
    } else {
      check('setup creation succeeds', false, pend);
    }
  }

  await cleanup();

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`PASSED ${passed}  FAILED ${failed}`);
  if (failures.length) {
    console.log('Failed checks:');
    for (const f of failures) console.log(`  - ${f}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});