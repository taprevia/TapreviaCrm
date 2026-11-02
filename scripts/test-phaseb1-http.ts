/**
 * Phase B.1 HTTP endpoint tests against the isolated Next server on :3100.
 *
 * Uses the disposable :27019 MongoDB and the loopback mock OpenAI provider.
 * Never contacts real OpenAI, the live site, or localhost:3000.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { ALIASES, IDS, assertIsolatedTarget, seedPhaseb1, snapshotProtectedData } from './phaseb1-fixtures';

assertIsolatedTarget();

const BASE = process.env.B1_HTTP_BASE ?? 'http://127.0.0.1:3100';
const ORIGIN = process.env.B1_ORIGIN ?? 'http://localhost:3100';
const MOCK = process.env.B1_MOCK_BASE ?? 'http://127.0.0.1:3199';
const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (!JWT_SECRET) throw new Error('JWT_SECRET is required for synthetic auth');

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

const ownerToken = jwt.sign({ userId: String(IDS.owner), role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const noSettingsToken = jwt.sign({ userId: String(IDS.noSettings), role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });

let ipCounter = 10;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

interface HttpResult {
  status: number;
  json: any;
  text: string;
}

async function request(method: string, pathname: string, options: { token?: string; body?: unknown } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = {
    // Same-origin header required by the CSRF gate for cookie-authed mutations.
    origin: ORIGIN,
    'x-forwarded-for': nextIp(),
    'user-agent': 'phaseb1-http-test',
  };
  if (options.token) headers.cookie = `token=${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* HTML or empty */
  }
  return { status: res.status, json, text };
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/settings`);
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Isolated server did not become ready at ${BASE}`);
}

async function mockLast(): Promise<{ authorization?: string; user?: string; system?: string } | null> {
  const res = await fetch(`${MOCK}/last`);
  const body = (await res.json()) as { last?: { authorization?: string; user?: string; system?: string } | null };
  return body.last ?? null;
}

async function resetMock(): Promise<void> {
  await fetch(`${MOCK}/reset`, { method: 'POST' });
}

async function patchProvider(body: Record<string, unknown>): Promise<HttpResult> {
  return request('PATCH', '/api/settings', { token: ownerToken, body });
}

async function generate(alias: string, body: Record<string, unknown> = {}): Promise<HttpResult> {
  return request('POST', `/api/public/reviews/${alias}/generate`, {
    body: { feedback: 'The coffee and service were excellent.', topics: ['service'], ...body },
  });
}

async function generateStandee(slug: string): Promise<HttpResult> {
  return request('POST', `/api/public/standee-reviews/${slug}/generate`, {
    body: { feedback: 'The coffee and service were excellent.', topics: ['service'] },
  });
}

async function main() {
  const before = await (async () => {
    await seedPhaseb1();
    return snapshotProtectedData();
  })();
  await waitForServer();
  const db = mongoose.connection.db!;

  // ── Engine A over real HTTP ──────────────────────────────────────────────
  const legacy = await generate(ALIASES.legacy);
  check(
    'POST card /generate (legacy, no key) → 200 library + editable text',
    legacy.status === 200 && legacy.json?.engine === 'library' && typeof legacy.json?.review === 'string' && legacy.json.review.includes('Legacy Business'),
    `${legacy.status} engine=${legacy.json?.engine} review=${String(legacy.json?.review).slice(0, 70)}`
  );

  const central = await generate(ALIASES.central);
  check(
    'POST card /generate (central, no key) → 200 library + central businessName',
    central.status === 200 && central.json?.engine === 'library' && central.json.review.includes('Central Business'),
    `${central.status} engine=${central.json?.engine} review=${String(central.json?.review).slice(0, 70)}`
  );

  const hybrid = await generate(ALIASES.hybrid);
  check(
    'POST card /generate (hybrid) → 200 library via central + override',
    hybrid.status === 200 && hybrid.json?.engine === 'library' && hybrid.json.review.includes('Central Business'),
    `${hybrid.status} engine=${hybrid.json?.engine}`
  );

  const noCategory = await generate(ALIASES.noCategory);
  check(
    'POST card /generate (no matching template) → 404 NO_MATCHING_REVIEW_TEMPLATE',
    noCategory.status === 404 && noCategory.json?.code === 'NO_MATCHING_REVIEW_TEMPLATE' && /No matching review suggestion/.test(noCategory.json?.error ?? ''),
    `${noCategory.status} code=${noCategory.json?.code}`
  );

  const disabled = await generate(ALIASES.disabled);
  check(
    'POST card /generate (AI disabled) → 404 NOT_FOUND, ordinary redirects untouched',
    disabled.status === 404 && disabled.json?.code === 'NOT_FOUND',
    `${disabled.status} code=${disabled.json?.code}`
  );

  const missingAlias = await generate('b1-does-not-exist');
  check(
    'POST card /generate (unknown alias) → 404 NOT_FOUND',
    missingAlias.status === 404 && missingAlias.json?.code === 'NOT_FOUND',
    `${missingAlias.status} code=${missingAlias.json?.code}`
  );

  const badBody = await generate(ALIASES.legacy, { feedback: 'x' });
  check(
    'POST card /generate (validation) → 400 VALIDATION_ERROR contract preserved',
    badBody.status === 400 && badBody.json?.code === 'VALIDATION_ERROR',
    `${badBody.status} code=${badBody.json?.code}`
  );

  const standee = await generateStandee(ALIASES.standee);
  check(
    'POST standee /generate (Google Review Standee, no key) → 200 library',
    standee.status === 200 && standee.json?.engine === 'library' && typeof standee.json?.review === 'string' && standee.json.review.length > 0,
    `${standee.status} engine=${standee.json?.engine} review=${String(standee.json?.review).slice(0, 60)}`
  );

  const aio3 = await generateStandee(ALIASES.aio3);
  check(
    'POST standee /generate (All In One 3, no key) → 200 library',
    aio3.status === 200 && aio3.json?.engine === 'library' && aio3.json.review.length > 0,
    `${aio3.status} engine=${aio3.json?.engine}`
  );

  const aio4 = await generateStandee(ALIASES.aio4);
  check(
    'POST standee /generate (All In One 4, no key) → 200 library',
    aio4.status === 200 && aio4.json?.engine === 'library' && aio4.json.review.length > 0,
    `${aio4.status} engine=${aio4.json?.engine}`
  );

  // ── Non-mutating GET /api/settings ───────────────────────────────────────
  const beforeCount = await db.collection('tenantsettings').countDocuments({ userId: IDS.noSettings });
  const noSettingsGet = await request('GET', '/api/settings', { token: noSettingsToken });
  const middleCount = await db.collection('tenantsettings').countDocuments({ userId: IDS.noSettings });
  const noSettingsGet2 = await request('GET', '/api/settings', { token: noSettingsToken });
  const afterCount = await db.collection('tenantsettings').countDocuments({ userId: IDS.noSettings });
  check(
    'GET /api/settings returns defaults without creating a tenant document',
    noSettingsGet.status === 200 &&
      noSettingsGet2.status === 200 &&
      noSettingsGet.json?.settings?.openai?.hasApiKey === false &&
      noSettingsGet.json?.settings?.openai?.enabled === false &&
      beforeCount === 0 &&
      middleCount === 0 &&
      afterCount === 0,
    `status=${noSettingsGet.status} docsBefore=${beforeCount} docsAfterFirst=${middleCount} docsAfterSecond=${afterCount}`
  );

  // ── Central management API + provider panel ─────────────────────────────
  const management = await request('GET', '/api/review-management', { token: ownerToken });
  check(
    'GET /api/review-management exposes businessName, central flag and aiConfigured',
    management.status === 200 &&
      management.json?.settings?.general?.businessName === 'Central Business' &&
      management.json?.publicIntegrationEnabled === true &&
      management.json?.aiConfigured === false,
    `${management.status} businessName=${management.json?.settings?.general?.businessName} public=${management.json?.publicIntegrationEnabled} ai=${management.json?.aiConfigured}`
  );

  const patchKey = await patchProvider({ openai: { enabled: true, apiKey: 'mock-owner-key', dailyLimit: 0 } });
  const keyText = JSON.stringify(patchKey.json ?? {});
  const getAfterKey = await request('GET', '/api/settings', { token: ownerToken });
  check(
    'PATCH /api/settings stores an encrypted key write-only (never echoed)',
    patchKey.status === 200 &&
      patchKey.json?.settings?.openai?.hasApiKey === true &&
      patchKey.json?.settings?.openai?.enabled === true &&
      !keyText.includes('mock-owner-key') &&
      getAfterKey.status === 200 &&
      getAfterKey.json?.settings?.openai?.hasApiKey === true &&
      !JSON.stringify(getAfterKey.json).includes('mock-owner-key'),
    `${patchKey.status} hasApiKey=${patchKey.json?.settings?.openai?.hasApiKey} echoed=${keyText.includes('mock-owner-key')}`
  );

  const patchModel = await patchProvider({ openai: { model: 'gpt-4o-mini-synthetic' } });
  const modelGet = await request('GET', '/api/settings', { token: ownerToken });
  check(
    'Central provider model is manageable through the existing settings API',
    patchModel.status === 200 && modelGet.json?.settings?.openai?.model === 'gpt-4o-mini-synthetic',
    `${patchModel.status} model=${modelGet.json?.settings?.openai?.model}`
  );
  await patchProvider({ openai: { model: 'gpt-4o-mini' } });

  await resetMock();
  const aiSuccess = await generate(ALIASES.central);
  const lastSuccess = await mockLast();
  check(
    'Configured OpenAI over HTTP → 200 engine=openai and mock received tenant key + businessName',
    aiSuccess.status === 200 &&
      aiSuccess.json?.engine === 'openai' &&
      aiSuccess.json.review.includes('Mock HTTP OpenAI draft for Central Business') &&
      lastSuccess?.authorization === 'Bearer mock-owner-key' &&
      (lastSuccess?.user ?? '').includes('Central Business') &&
      (lastSuccess?.system ?? '').includes('professional and polished'),
    `${aiSuccess.status} engine=${aiSuccess.json?.engine} auth=${lastSuccess?.authorization} nameInPrompt=${(lastSuccess?.user ?? '').includes('Central Business')}`
  );

  const managementWithAi = await request('GET', '/api/review-management', { token: ownerToken });
  check(
    'GET /api/review-management reports aiConfigured=true after key setup',
    managementWithAi.status === 200 && managementWithAi.json?.aiConfigured === true,
    `${managementWithAi.status} ai=${managementWithAi.json?.aiConfigured}`
  );

  // ── Provider failure modes: never silently fall back ────────────────────
  await patchProvider({ openai: { enabled: true, apiKey: 'invalid-key', dailyLimit: 0 } });
  await resetMock();
  const invalid = await generate(ALIASES.central);
  check(
    'Invalid credentials over HTTP → 503 UNAVAILABLE, no library substitution',
    invalid.status === 503 && invalid.json?.code === 'UNAVAILABLE' && invalid.json?.review === undefined,
    `${invalid.status} code=${invalid.json?.code} review=${invalid.json?.review ?? 'none'}`
  );

  await patchProvider({ openai: { enabled: true, apiKey: 'empty-key', dailyLimit: 0 } });
  const empty = await generate(ALIASES.central);
  check(
    'Empty provider response over HTTP → 503 UNAVAILABLE, no library substitution',
    empty.status === 503 && empty.json?.code === 'UNAVAILABLE' && empty.json?.review === undefined,
    `${empty.status} code=${empty.json?.code}`
  );

  await patchProvider({ openai: { enabled: true, apiKey: 'fail-key', dailyLimit: 0 } });
  const failed = await generate(ALIASES.central);
  check(
    'Provider 5xx over HTTP → 503 UNAVAILABLE, no library substitution',
    failed.status === 503 && failed.json?.code === 'UNAVAILABLE' && failed.json?.review === undefined,
    `${failed.status} code=${failed.json?.code}`
  );

  // ── Disabled / cleared provider returns to the library ──────────────────
  await patchProvider({ openai: { enabled: false } });
  const disabledProvider = await generate(ALIASES.central);
  check(
    'OpenAI disabled over HTTP → stored library',
    disabledProvider.status === 200 && disabledProvider.json?.engine === 'library',
    `${disabledProvider.status} engine=${disabledProvider.json?.engine}`
  );

  await patchProvider({ openai: { enabled: true, apiKey: '' } });
  const clearedKey = await generate(ALIASES.central);
  const clearedGet = await request('GET', '/api/settings', { token: ownerToken });
  check(
    'Cleared key over HTTP → stored library and hasApiKey=false',
    clearedKey.status === 200 &&
      clearedKey.json?.engine === 'library' &&
      clearedGet.json?.settings?.openai?.hasApiKey === false,
    `${clearedKey.status} engine=${clearedKey.json?.engine} hasApiKey=${clearedGet.json?.settings?.openai?.hasApiKey}`
  );

  // ── Cross-tenant isolation over HTTP ────────────────────────────────────
  await patchProvider({ openai: { enabled: true, apiKey: 'mock-owner-key', dailyLimit: 0 } });
  const other = await generate(ALIASES.other);
  check(
    'Cross-tenant request ignores another tenant OpenAI config and uses its own library',
    other.status === 200 &&
      other.json?.engine === 'library' &&
      other.json.review.includes('Other Business') &&
      !other.json.review.includes('Central Business'),
    `${other.status} engine=${other.json?.engine} review=${String(other.json?.review).slice(0, 70)}`
  );

  // ── Central business-name write → both engines consume it ───────────────
  const rename = await request('PATCH', '/api/review-management', {
    token: ownerToken,
    body: { general: { businessName: 'Central Renamed' } },
  });
  await patchProvider({ openai: { enabled: false } });
  const renamedLibrary = await generate(ALIASES.central);
  check(
    'Central businessName saved via API is used by the stored library',
    rename.status === 200 && renamedLibrary.status === 200 && renamedLibrary.json?.review?.includes('Central Renamed'),
    `${rename.status} library=${renamedLibrary.status} review=${String(renamedLibrary.json?.review).slice(0, 70)}`
  );
  await request('PATCH', '/api/review-management', {
    token: ownerToken,
    body: { general: { businessName: 'Central Business' } },
  });

  // ── Duplicate customer-facing AI controls retired ───────────────────────
  const settingsPage = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(dashboard)/dashboard/settings/page.tsx'),
    'utf8'
  );
  check(
    'Dashboard Settings no longer contains duplicate OpenAI/AI review controls',
    !settingsPage.includes('OpenAI API key') &&
      !settingsPage.includes('AI review generation') &&
      !settingsPage.includes('openai-daily-limit') &&
      !settingsPage.includes('openai-key'),
    `removed=${!settingsPage.includes('OpenAI API key') && !settingsPage.includes('AI review generation')}`
  );

  // ── Data integrity ──────────────────────────────────────────────────────
  const after = await snapshotProtectedData();
  check(
    'Protected synthetic records unchanged after all HTTP engine/settings calls',
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(before) === JSON.stringify(after) ? 'no drift' : 'DRIFT DETECTED'
  );

  void assert;

  const failures = results.filter((r) => !r.pass);
  console.log('\n=== PHASE B.1 HTTP SUMMARY ===');
  console.log(JSON.stringify({
    base: BASE,
    checks: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    failures,
  }, null, 2));
  await mongoose.disconnect();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
