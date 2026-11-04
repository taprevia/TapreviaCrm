/**
 * PPL03-01 focused regression — new card slugs must not claim legacy aliases.
 *
 * Setup (isolated DB only):
 *   legacy card: slug=legacy-slug, urlAlias=legacy-alias
 *   new card UID: legacy-alias
 *
 * Expected after fix:
 *   new slug/alias = legacy-alias-1 (or further suffix)
 *   legacy alias/slug unchanged
 *   /profile/legacy-alias still resolves the legacy card
 *   /profile/legacy-alias-1 resolves the new card
 *
 * Also checks the pre-existing slug suffix behavior and records the remaining
 * read-time concurrency limitation.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import User from '@/models/User';
import { provisionCardForAssignment } from '@/lib/services/card-identity';
import { getPublicCardByAlias } from '@/lib/services/card-access';
import { getPublicCardByPublicSlug } from '@/lib/services/human-url';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.log(`FAIL ${name} — ${message}`);
    });
}

const dbName = process.env.MONGODB_DB ?? '';
if (!dbName.startsWith('ppl03_')) {
  console.error(`Refusing to run: MONGODB_DB must start with ppl03_ (got "${dbName}")`);
  process.exit(2);
}

async function main(): Promise<void> {
  await connectDB();
  await Promise.all([Card.init(), User.init()]);
  await Promise.all([Card.deleteMany({}), User.deleteMany({})]);

  const legacyUser = await User.create({
    name: 'Legacy Owner',
    email: 'ppl0301-legacy@test.local',
    passwordHash: 'x',
    role: 'customer',
    status: 'active',
  });
  const newUser = await User.create({
    name: 'New Owner',
    email: 'ppl0301-new@test.local',
    passwordHash: 'x',
    role: 'customer',
    status: 'active',
  });

  const legacy = await Card.create({
    cardUid: 'LEGACY-A',
    slug: 'legacy-slug',
    urlAlias: 'legacy-alias',
    routeSlug: 'legacy-route',
    uid: 'legacy-route',
    publicSlug: 'ppl03biz/premium-card',
    kind: 'profile',
    status: 'active',
    isActive: true,
    userId: legacyUser._id,
    assignedUserId: legacyUser._id,
  });

  const provisioned = await provisionCardForAssignment({
    uid: 'legacy-alias',
    userId: String(newUser._id),
    userName: newUser.name,
    kind: 'profile',
  });
  assert.equal(provisioned.ok, true, provisioned.ok ? '' : provisioned.error);
  if (!provisioned.ok) return;
  const created = provisioned.card;

  const legacyAfter = await Card.findById(legacy._id).lean<Record<string, unknown> | null>();
  const byLegacyAlias = await getPublicCardByAlias('legacy-alias');
  const byNewAlias = await getPublicCardByAlias(String(created.urlAlias));
  const byLegacyPublicSlug = await getPublicCardByPublicSlug('ppl03biz/premium-card');

  await check('new card receives a different slug from the legacy alias', () => {
    assert.notEqual(created.slug, 'legacy-alias');
    assert.equal(created.slug, 'legacy-alias-1');
  });

  await check('new card alias mirrors its new slug (immutable association)', () => {
    assert.equal(created.urlAlias, created.slug);
    assert.equal(created.urlAlias, 'legacy-alias-1');
  });

  await check('legacy alias and slug remain unchanged', () => {
    assert.equal(legacyAfter?.urlAlias, 'legacy-alias');
    assert.equal(legacyAfter?.slug, 'legacy-slug');
    assert.equal(legacyAfter?.routeSlug, 'legacy-route');
    assert.equal(legacyAfter?.publicSlug, 'ppl03biz/premium-card');
  });

  await check('legacy alias still resolves to the legacy card', () => {
    assert.ok(byLegacyAlias);
    assert.equal(String(byLegacyAlias?._id), String(legacy._id));
  });

  await check('new public alias resolves to the new card', () => {
    assert.ok(byNewAlias);
    assert.equal(String(byNewAlias?._id), String(created._id));
  });

  await check('legacy publicSlug still resolves to the legacy card', () => {
    assert.ok(byLegacyPublicSlug);
    assert.equal(String(byLegacyPublicSlug?._id), String(legacy._id));
  });

  await check('no document shares the legacy alias key', async () => {
    const matches = await Card.find({
      $or: [{ urlAlias: 'legacy-alias' }, { slug: 'legacy-alias' }],
    })
      .select('_id')
      .lean<Array<{ _id: unknown }>>();
    assert.equal(matches.length, 1);
    assert.equal(String(matches[0]?._id), String(legacy._id));
  });

  // Existing slug-only collision behavior must still suffix.
  const slugOnly = await Card.create({
    cardUid: 'SLUG-ONLY',
    slug: 'slug-only',
    urlAlias: 'slug-only-alias',
    routeSlug: 'slug-only-route',
    uid: 'slug-only-route',
    kind: 'profile',
    status: 'active',
    isActive: true,
    userId: legacyUser._id,
    assignedUserId: legacyUser._id,
  });
  const second = await provisionCardForAssignment({
    // Distinct physical UID; its slug base normalizes to the occupied slug.
    uid: 'slug_only',
    userId: String(newUser._id),
    userName: newUser.name,
    kind: 'profile',
  });
  assert.equal(second.ok, true, second.ok ? '' : second.error);
  if (second.ok) {
    await check('existing slug collision still generates a suffix', () => {
      assert.equal(second.card.slug, 'slug-only-1');
      assert.equal(second.card.urlAlias, 'slug-only-1');
      assert.equal(slugOnly.slug, 'slug-only');
    });
  }

  // Concurrency limitation (informational): two concurrent provisions whose
  // UIDs sanitize to the same base. The unique slug index prevents duplicates;
  // one request may fail with E11000 because the read-time loop is not atomic.
  const concurrent = await Promise.allSettled([
    provisionCardForAssignment({ uid: 'race_a', userId: String(newUser._id), userName: newUser.name, kind: 'profile' }),
    provisionCardForAssignment({ uid: 'race-a', userId: String(newUser._id), userName: newUser.name, kind: 'profile' }),
  ]);
  const raceDocs = await Card.find({ slug: /^race-a(?:-\d+)?$/ }).select('slug').lean<Array<{ slug: string }>>();
  const uniqueApplied = new Set(raceDocs.map((doc) => doc.slug)).size === raceDocs.length;
  console.log(
    `INFO concurrent slug-base allocation: ${JSON.stringify(
      concurrent.map((result) => (result.status === 'fulfilled' ? (result.value.ok ? 'ok' : result.value.error) : 'rejected'))
    )}; documents=${raceDocs.length}; unique=${uniqueApplied}`
  );

  await mongoose.connection.db!.dropDatabase();
  await mongoose.disconnect();

  console.log(`\nPPL03-01 alias collision: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
