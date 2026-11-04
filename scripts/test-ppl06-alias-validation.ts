/**
 * PPL06-01 / PPL06-02 focused regression.
 *
 * Verifies the shared alias contract used by `aliasSchema` and the
 * `/api/cards/check-alias` endpoint:
 *   - same format rules (no leading/trailing hyphen, 3–40 chars, ASCII)
 *   - same reserved list (qr/public rejected; assets/static accepted)
 *   - endpoint checks both Card.slug and Card.urlAlias
 *   - existing identifiers are not modified
 *
 * Write tests require an isolated DB prefixed `ppl06_`.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { connectDB } from '@/lib/db';
import { aliasSchema, validateAlias } from '@/lib/validation/common';
import { generateToken } from '@/lib/auth';
import Card from '@/models/Card';
import User from '@/models/User';
import { GET as checkAlias } from '@/app/api/cards/check-alias/route';

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
if (!dbName.startsWith('ppl06_')) {
  console.error(`Refusing to run: MONGODB_DB must start with ppl06_ (got "${dbName}")`);
  process.exit(2);
}

const FORMAT_CASES: Array<{ value: string; valid: boolean; reason?: 'INVALID' | 'RESERVED' }> = [
  { value: 'business-name', valid: true },
  { value: 'business123', valid: true },
  { value: '-business', valid: false, reason: 'INVALID' },
  { value: 'business-', valid: false, reason: 'INVALID' },
  { value: 'business--name', valid: true },
  { value: 'business_name', valid: false, reason: 'INVALID' },
  { value: '', valid: false, reason: 'INVALID' },
  { value: 'ab', valid: false, reason: 'INVALID' },
  { value: 'a-b', valid: true },
  { value: 'a'.repeat(40), valid: true },
  { value: 'a'.repeat(41), valid: false, reason: 'INVALID' },
  { value: 'admin', valid: false, reason: 'RESERVED' },
  { value: 'qr', valid: false, reason: 'RESERVED' },
  { value: 'public', valid: false, reason: 'RESERVED' },
  { value: 'api', valid: false, reason: 'RESERVED' },
  { value: 'assets', valid: true },
  { value: 'static', valid: true },
  { value: 'review', valid: true },
  { value: 'panel', valid: true },
  { value: 'standee-review', valid: true },
  { value: 'preview', valid: true },
  { value: 'Business-Name', valid: true },
];

interface AliasResponse {
  available?: boolean;
  reason?: string;
  suggestion?: string;
}

async function requestAlias(
  token: string,
  alias: string,
  excludeId?: string
): Promise<AliasResponse> {
  const url = new URL('http://localhost/api/cards/check-alias');
  url.searchParams.set('alias', alias);
  if (excludeId) url.searchParams.set('excludeId', excludeId);
  const request = new NextRequest(url, {
    headers: { cookie: `token=${token}` },
  });
  const response = await checkAlias(request);
  assert.equal(response.status, 200, `check-alias status for ${alias}`);
  return (await response.json()) as AliasResponse;
}

async function main(): Promise<void> {
  await connectDB();
  await Promise.all([Card.init(), User.init()]);
  await Promise.all([Card.deleteMany({}), User.deleteMany({})]);

  /* ── Pure schema / shared validator agreement ───────────────────────── */

  for (const testCase of FORMAT_CASES) {
    await check(`schema and validator agree for ${JSON.stringify(testCase.value)}`, () => {
      const schema = aliasSchema.safeParse(testCase.value);
      const shared = validateAlias(testCase.value);
      assert.equal(schema.success, testCase.valid);
      assert.equal(shared.ok, testCase.valid);
      if (!shared.ok) assert.equal(shared.reason, testCase.reason);
      if (schema.success) {
        // Both normalize the same way (lowercase/trim).
        assert.equal(schema.data, shared.ok ? shared.value : schema.data);
      }
    });
  }

  await check('trailing hyphen is rejected (previous bug)', () => {
    assert.equal(aliasSchema.safeParse('business-').success, false);
    assert.deepEqual(validateAlias('business-'), { ok: false, reason: 'INVALID' });
  });

  await check('leading hyphen is rejected', () => {
    assert.equal(aliasSchema.safeParse('-business').success, false);
  });

  await check('consecutive internal hyphens remain valid', () => {
    assert.equal(aliasSchema.safeParse('business--name').success, true);
  });

  /* ── Endpoint contract ─────────────────────────────────────────────── */

  const user = await User.create({
    name: 'Alias Tester',
    email: 'ppl06-alias@test.local',
    passwordHash: 'x',
    role: 'customer',
    status: 'active',
  });
  const token = generateToken(String(user._id), user.role);

  const existing = await Card.create({
    cardUid: 'PPL06-ALIAS-CARD',
    slug: 'taken-slug',
    urlAlias: 'taken-alias',
    routeSlug: 'ppl06-route',
    uid: 'ppl06-route',
    kind: 'profile',
    status: 'active',
    isActive: true,
    userId: user._id,
    assignedUserId: user._id,
  });

  await check('endpoint detects an existing Card.slug collision', async () => {
    const result = await requestAlias(token, 'taken-slug');
    assert.equal(result.available, false);
    assert.ok(result.suggestion, 'expected a suggestion for a taken slug');
  });

  await check('endpoint detects an existing Card.urlAlias collision', async () => {
    const result = await requestAlias(token, 'taken-alias');
    assert.equal(result.available, false);
    assert.ok(result.suggestion, 'expected a suggestion for a taken alias');
  });

  await check('excludeId allows the owning card to keep its alias', async () => {
    const result = await requestAlias(token, 'taken-alias', String(existing._id));
    assert.equal(result.available, true);
  });

  await check('unused valid alias is available', async () => {
    const result = await requestAlias(token, 'free-alias');
    assert.equal(result.available, true);
  });

  for (const reserved of ['admin', 'qr', 'public', 'api']) {
    await check(`endpoint rejects reserved alias ${reserved}`, async () => {
      const result = await requestAlias(token, reserved);
      assert.equal(result.available, false);
      assert.equal(result.reason, 'RESERVED');
    });
  }

  for (const formerlyMisaligned of ['assets', 'static']) {
    await check(`endpoint accepts ${formerlyMisaligned} consistently with the schema`, async () => {
      const result = await requestAlias(token, formerlyMisaligned);
      assert.equal(result.available, true);
    });
  }

  for (const invalid of ['business-', '-business', 'business_name', 'ab']) {
    await check(`endpoint rejects invalid alias ${invalid}`, async () => {
      const result = await requestAlias(token, invalid);
      assert.equal(result.available, false);
      assert.equal(result.reason, 'INVALID');
    });
  }

  await check('endpoint accepts consecutive internal hyphens', async () => {
    const result = await requestAlias(token, 'business--name');
    assert.equal(result.available, true);
  });

  await check('existing identifiers are unchanged', async () => {
    const after = await Card.findById(existing._id).lean<Record<string, unknown> | null>();
    assert.equal(after?.slug, 'taken-slug');
    assert.equal(after?.urlAlias, 'taken-alias');
    assert.equal(after?.routeSlug, 'ppl06-route');
    assert.equal(after?.uid, 'ppl06-route');
  });

  await mongoose.connection.db!.dropDatabase();
  await mongoose.disconnect();

  console.log(`\nPPL06 alias validation: ${passed} passed, ${failed} failed`);
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
