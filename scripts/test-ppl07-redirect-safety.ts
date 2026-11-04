/**
 * PPL-07 focused regression: bounded loop detection + no-store responses.
 *
 * Run with an isolated DB prefixed `ppl07_`. The actual HTTP matrix (status,
 * headers, analytics) is documented in the PPL-07 fix report; this test keeps
 * the graph/no-store contract runnable without a server.
 */

import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Standee from '@/models/Standee';
import User from '@/models/User';
import { wouldRedirectLoop } from '@/lib/services/redirect-loop';
import { noStoreRedirect, noStoreText } from '@/lib/no-store';

const DB_NAME = process.env.MONGODB_DB ?? '';
if (!DB_NAME.startsWith('ppl07_')) {
  console.error(`Refusing to run: MONGODB_DB must start with ppl07_ (got "${DB_NAME}")`);
  process.exit(2);
}

const ORIGIN = 'http://localhost:3501';
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL ${name} — ${message}`);
  }
}

async function main(): Promise<void> {
  await connectDB();
  await Promise.all([Card.init(), Standee.init(), User.init()]);
  await Promise.all([Card.deleteMany({}), Standee.deleteMany({}), User.deleteMany({})]);

  const user = await User.create({
    name: 'PPL07 Owner',
    email: 'ppl07-graph@test.local',
    passwordHash: 'x',
    role: 'customer',
    status: 'active',
  });
  const base = {
    userId: user._id,
    assignedUserId: user._id,
    status: 'active',
    isActive: true,
    kind: 'profile',
  };
  const social = (uid: string, route: string, redirectUrl: string, publicSlug?: string) =>
    Card.create({
      ...base,
      kind: 'social',
      cardUid: `PPL07-${uid}`,
      slug: `ppl07-${uid}`,
      urlAlias: `ppl07-${uid}`,
      routeSlug: route,
      uid: route,
      publicSlug,
      redirectUrl,
    });

  await social('loop-a', 'ppl07-loop-a', `${ORIGIN}/r/ppl07-loop-b`);
  await social('loop-b', 'ppl07-loop-b', `${ORIGIN}/r/ppl07-loop-a`);
  await social('self-r', 'ppl07-self-r', `${ORIGIN}/r/ppl07-self-r`);
  await social('pub', 'ppl07-pub', `${ORIGIN}/ppl07biz/social`, 'ppl07biz/social');
  await Card.create({
    ...base,
    cardUid: 'PPL07-PROFILE',
    slug: 'ppl07-profile',
    urlAlias: 'ppl07-profile',
    routeSlug: 'ppl07-profile',
    uid: 'ppl07-profile',
    publicSlug: 'ppl07biz/profile',
  });
  await Standee.create({
    userId: user._id,
    name: 'PPL07 Standee',
    routeSlug: 'ppl07-standee',
    uid: 'ppl07-standee',
    publicSlug: 'ppl07biz/standee',
    maxProfiles: 1,
    fixedProfiles: ['instagram'],
    panelQr: { qrId: 'PPL07-PANEL' },
    socialQrs: [{
      qrId: 'PPL07-SOC',
      platform: 'instagram',
      label: 'Instagram',
      destinationUrl: `${ORIGIN}/r/ppl07-standee/1`,
    }],
  });

  await check('direct permanent self-loop is detected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-self-r', `${ORIGIN}/r/ppl07-self-r`, ORIGIN), true);
  });

  await check('case/query/encoded permanent self-loop is detected', async () => {
    assert.equal(await wouldRedirectLoop('/R/PPL07-SELF-R', `${ORIGIN}/r/ppl07-self-r?x=1#frag`, ORIGIN), true);
  });

  await check('two-card permanent cycle is detected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-loop-a', `${ORIGIN}/r/ppl07-loop-b`, ORIGIN), true);
  });

  await check('public URL self-loop is detected', async () => {
    assert.equal(await wouldRedirectLoop('/ppl07biz/social', `${ORIGIN}/ppl07biz/social`, ORIGIN), true);
  });

  await check('permanent → public → permanent cycle is detected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-pub', `${ORIGIN}/ppl07biz/social`, ORIGIN), true);
  });

  await check('standee slot self-loop is detected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-standee/1', `${ORIGIN}/r/ppl07-standee/1`, ORIGIN), true);
  });

  await check('/qr social slot → looping /r slot is detected', async () => {
    assert.equal(await wouldRedirectLoop('/qr/PPL07-SOC', `${ORIGIN}/r/ppl07-standee/1`, ORIGIN), true);
  });

  await check('valid external destination is not rejected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-self-r', 'https://example.test/destination', ORIGIN), false);
  });

  await check('valid internal profile destination is not rejected', async () => {
    assert.equal(await wouldRedirectLoop('/r/ppl07-profile', `${ORIGIN}/ppl07biz/profile`, ORIGIN), false);
  });

  await check('no-store redirect headers are applied', () => {
    const response = noStoreRedirect('https://example.test', 307);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  });

  await check('no-store text headers are applied', () => {
    const response = noStoreText('Redirect loop detected', 404);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0, must-revalidate');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  });

  await mongoose.connection.db!.dropDatabase();
  await mongoose.disconnect();

  console.log(`\nPPL07 redirect safety: ${passed} passed, ${failed} failed`);
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
