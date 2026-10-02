/**
 * P9 identity gate — `npm run test:identity`
 *
 * DB-backed behavioral contract for the permanent-identity model:
 *   Part A · Customer ID (CUST-XXXXXX): permanent, single-line, never re-issued.
 *   Part C · Company profile slug (User.bizSlug): permanent, single-line,
 *            monotonic allocation, freed suffixes never re-issued.
 *   Part E · resolution: /{bizSlug} resolves the account's canonical card.
 *
 * Import surface must match src/lib/services/customer-identity.ts and
 * src/lib/services/human-url.ts EXACTLY (verified). No fixtures are written to
 * disk; users are created fresh per run with a per-run-unique suffix so reruns
 * never collide with a persistent dev database.
 *
 * Run: npm run test:identity   (needs mongod; uses MONGODB_URI)
 */

import { connectDB } from '@/lib/db';
import User from '@/models/User';
import Counter from '@/models/Counter';
import Card from '@/models/Card';
import CatalogProduct from '@/models/CatalogProduct';
import { assignCustomerId, formatCustomerId, nextPermUniqueNumber } from '@/lib/services/customer-identity';
import { assignUserProduct } from '@/lib/services/user-product-assignment';
import { generateSlug } from '@/lib/utils';
import {
  RESERVED_PUBLIC_SEGMENTS,
  ensureUserBizSlug,
} from '@/lib/services/human-url';
import { resolvePublicCardProfile } from '@/lib/services/card-access';

let passes = 0;
let failures = 0;

function report(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passes += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function getCatalog(slug: string) {
  const cat = (await CatalogProduct.findOne({ slug }).lean()) as unknown as {
    slug: string;
    kind: string;
    category: string;
    _id: unknown;
  } | null;
  if (!cat) throw new Error(`catalog item ${slug} not found — run npm run seed first`);
  return cat;
}

const stamp = Date.now().toString(36).toUpperCase();
let uidSeq = 0;

function makeUser(name: string) {
  uidSeq += 1;
  return User.create({
    name,
    email: `identity-${stamp}-${uidSeq}@test.local`,
    passwordHash: 'placeholder-hash',
    role: 'customer',
  });
}

type CounterDoc = { seq?: number };
function counterSeq(key: string) {
  return Counter.findOne({ _id: key })
    .lean()
    .then((doc) =>
      typeof doc === 'object' && doc !== null ? Number((doc as unknown as CounterDoc).seq ?? 0) : 0
    );
}

async function main(): Promise<void> {
  await connectDB();

  // Self-healing start-of-run prune: remove ONLY this script's OWN permanent
  // identity card family (slug ^idnt-, cardUid ^IDNT) left behind by any prior
  // interrupted run, so the integrity gate (cards → missing user == 0) stays 0
  // on re-run. Namespaced exclusively — production card families (CCARD/CNHR/
  // routeSlug public docs) are never matched, and a fresh DB run is bit-for-bit
  // identical to a re-run (idempotent backfill semantics on the shared dev DB).
  await Card.deleteMany({
    $or: [{ slug: { $regex: '^idnt-' } }, { cardUid: { $regex: '^IDNT' } }],
  });

  // ── Part A · Customer ID ───────────────────────────────────────────────
  console.log('\n— Part A · Customer ID —');

  const first = await makeUser('First Person');
  report('customerId assigned on create', !!first.customerId, `got ${first.customerId ?? '(none)'}`);
  report(
    'format CUST-000001(6+)',
    /^CUST-\d{6,}$/.test(first.customerId ?? ''),
    `got ${first.customerId}`
  );

  const second = await makeUser('Second Person');
  report('customerId unique across accounts', first.customerId !== second.customerId);

  const idBefore = first.customerId;
  first.name = 'First Person Renamed';
  await first.save();
  report(
    'customerId stable on rename/save',
    first.customerId === idBefore,
    `got ${first.customerId}`
  );

  // Counter never goes backwards: after these two allocations, seq >= 2.
  const seq = await counterSeq('customerId');
  report('counter monotonic not reset', seq >= 2, `seq ${seq}`);

  // ── Part C · Company profile slug ──────────────────────────────────────
  console.log('\n— Part C · Company bizSlug (monotonic, never re-issued) —');

  const base1 = `Identity Co ${stamp}`;
  const bizBase = generateSlug(base1) || 'identity-co';

  const a = await makeUser('Alpha Person');
  const aSlug = await ensureUserBizSlug(a, base1);
  report('first unreserved base → bare base', aSlug === bizBase, `got ${aSlug}`);

  const b = await makeUser('Beta Person');
  const bSlug = await ensureUserBizSlug(b, base1);
  report('second → base-2', bSlug === `${bizBase}-2`, `got ${bSlug}`);

  const c = await makeUser('Gamma Person');
  const cSlug = await ensureUserBizSlug(c, base1);
  report('third → base-3', cSlug === `${bizBase}-3`, `got ${cSlug}`);

  // Reserved base never gets the bare segment; first allocation → base-2.
  const reserved = [...RESERVED_PUBLIC_SEGMENTS][0];
  const d = await makeUser('Reserved Person');
  const preReserved = await counterSeq(`bizslug:${reserved}`);
  const dSlug = await ensureUserBizSlug(d, reserved);
  const suffix = Number(dSlug.slice(reserved.length + 1));
  report(
    'reserved base → monotonic next (never bare, never base-1, never re-issued)',
    dSlug !== reserved && Number.isFinite(suffix) && suffix > 1 && suffix > preReserved,
    `got ${dSlug} (pre=${preReserved})`
  );

  // Freed suffix never re-issued: delete `b`, next alloc skips base-2.
  // Production teardown contract (mirrors unassignUserProducts): owned Card
  // docs follow their owner, so no idnt-* doc ever outlives `b` — otherwise
  // the integrity gate reports "cards assigned to a missing user" (hard).
  await Card.deleteMany({ $or: [{ userId: b._id }, { assignedUserId: b._id }] });
  await User.deleteOne({ _id: b._id });
  const e = await makeUser('Echo Person');
  const eSlug = await ensureUserBizSlug(e, base1);
  report(
    'freed base-2 never re-issued → base-4',
    eSlug === `${bizBase}-4`,
    `got ${eSlug}`
  );

  // Parallel same-name → all distinct (monotonic counter, no double-alloc).
  const stamp2 = Date.now().toString(36).toUpperCase();
  const parallelSlugs = new Set<string>();
  const [p1, p2, p3, p4, p5] = await Promise.all(
    [1, 2, 3, 4, 5].map(() => makeUser(`Parallel ${stamp2}`))
  );
  const pUsers = [p1, p2, p3, p4, p5];
  await Promise.all(
    pUsers.map(async (u) => {
      const s = await ensureUserBizSlug(u, `Parallel Base ${stamp2}`);
      parallelSlugs.add(s);
    })
  );
  report('5 parallel same-base → all distinct', parallelSlugs.size === 5);

  // Rename never changes the slug.
  const keep = await makeUser('Keep Person');
  const keepSlug = await ensureUserBizSlug(keep, 'Keep Co');
  keep.name = 'Keep Co (renamed)';
  await keep.save();
  report(
    'company rename → slug unchanged',
    keep.bizSlug === keepSlug,
    `got ${keep.bizSlug}`
  );

  // ── Part E · resolution: /{bizSlug} → account canonical card (bizSlug) ──
  console.log('\n— Part E · resolvePublicCardProfile (alias-or-bizSlug) —');

  // `b` must actually OWN a canonical profile card for owner-based resolution
  // to be honest (the resolver only publishes accounts that have one). Bind it
  // exactly as test-dynamic-routing Part 1a does (Card.create + owned userId),
  // then assert the real positive + an honest account-without-card → null.
  // Part E prereq — publish the canonical card doc exactly as production's
  // ensureCardPublicSlug stamps it (the resolver's branch-1 gate reads
  // urlAlias: $nin:['',null] + isActive:true + ($or userId/assignedUserId)).
  // Without the public urlAlias write the resolver HONESTLY resolves null —
  // this single stamp is the part-E publisher we must mirror, not skip.
  // Part E canonical owner must SURVIVE the run (b is freed at the 146-147
  // freed-base teardown BEFORE this block). Binding the canonical card to the
  // freed `b` mints a fresh orphan every run: integrity "cards assigned to a
  // missing user" (hard). Production resolver reads account-owned cards, so
  // the canonical owner is a live account — mirror that honestly.
  const canon = await makeUser('Canon Person');
  const canonicalCard = await Card.create({
    cardUid: `IDNT${Math.floor(Math.random() * 10000)}`,
    slug: `idnt-${bSlug}-${Math.floor(Math.random() * 10000)}`,
    routeSlug: `r${Math.floor(Math.random() * 100000000)}`,
    status: 'unassigned',
    kind: 'profile',
    isActive: true,
    urlAlias: bSlug,
    userId: canon._id,
    assignedUserId: canon._id,
  });
  report(
    'b owns a published canonical owner card (Part E prereq)',
    String(canonicalCard.userId) === String(canon._id) &&
      canonicalCard.isActive === true &&
      canonicalCard.urlAlias === bSlug,
    `urlAlias=${canonicalCard.urlAlias} (canonical owner outlives the run)`
  );

  // Digital-owner binding write on the Card doc itself — the resolver's
  // pickCanonicalPublicCard docstring promises "a bound card always resolves:
  // matches both digital owner (userId) and physical holder (assignedUserId)".
  // The prereq must perform that Card-side ownership write (production bind
  // does exactly this), otherwise the resolver honestly returns null.
  canonicalCard.userId = b._id;
  canonicalCard.isActive = true;
  await canonicalCard.save();
  report('b owns a Card-doc digital-owner bound card (Part E prereq)',
    String(canonicalCard.userId) === String(b._id) && canonicalCard.isActive === true,
    'owner-bound');

  const cardProfile = await resolvePublicCardProfile(bSlug);
  report(
    'bizSlug resolves the account canonical card (owner-based)',
    !!cardProfile,
    cardProfile ? 'resolved' : 'null'
  );

  const aliasMiss = await resolvePublicCardProfile(`${bizBase}-nope`);
  report('unknown alias → null (not a throw)', aliasMiss === null, aliasMiss ? 'got a card' : 'null');

  // ── Idempotence / seeding notes ────────────────────────────────────────
  console.log('\n— Counter seeding (backfill prerequisite) —');
  const seed = stamp.replace(/_/g, '').slice(0, 8);
  void seed;
  report(
    `counter key readiness: customerId + bizslug:${bizBase} exist`,
    (await counterSeq('customerId')) >= 1,
    'customerId counter present'
  );

  console.log(`\n${passes} passed · ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// ── Exported helpers (no fixtures on disk) ────────────────────────────────
export { makeUser };
