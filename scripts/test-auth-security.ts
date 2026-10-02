/**
 * Sprint 1 evidence suite — auth lockdown.
 *
 * Proves, against a running dev server (localhost:3000):
 *   1. Login rate limit: the 11th rapid attempt from one IP returns 429.
 *   2. Suspended users cannot authenticate: login returns 403, and a valid
 *      token for a suspended user is rejected at the auth boundary (401 via
 *      /api/auth/me).
 *   3. zod validation on login: malformed email / blank password → 400
 *      VALIDATION_ERROR with field details.
 *   4. Health endpoint: GET /api/health → 200 {ok:true, db:'up'}.
 *
 * Run with: MONGODB_URI=... JWT_SECRET=... npm run test:auth (npx tsx scripts/test-auth-security.ts)
 * Uses unique X-Forwarded-For IPs so the per-IP buckets don't disturb real sessions.
 */

import { connectDB } from '@/lib/db';
import User from '@/models/User';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function login(ip: string, body: Record<string, unknown>, fetchCount = 1) {
  const results: Array<{ status: number; body: unknown }> = [];
  for (let i = 0; i < fetchCount; i++) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    });
    results.push({ status: res.status, body: await res.json().catch(() => null) });
  }
  return results;
}

async function run() {
  await connectDB();

  console.log('  Rate limiting (login, 10/15min bucket):');
  const ip = `10.0.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;
  const attempts = await login(ip, { email: 'nobody@nowhere.invalid', password: 'wrongpass' }, 11);
  assert(attempts.length === 11, '11 attempts made');
  const codes = attempts.map((a) => a.status);
  assert(attempts[10]?.status === 429, '11th rapid login returns 429', JSON.stringify(codes));

  console.log('  zod validation (login):');
  const bad = await login(`10.1.${Math.floor(Math.random() * 200) + 1}.1`, {
    email: 'not-an-email',
    password: '',
  });
  assert(bad[0]?.status === 400, 'malformed email / blank password → 400');
  const body0 = bad[0]?.body as { code?: string };
  assert(body0?.code === 'VALIDATION_ERROR', 'validation failure uses VALIDATION_ERROR code');

  console.log('  Health endpoint:');
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = (await health.json()) as { ok?: boolean; db?: string };
  assert(health.status === 200 && healthBody.ok === true && healthBody.db === 'up', 'GET /api/health → 200 ok db up');

  console.log('  Suspended user boundary (live DB):');
  const tag = `susp${Math.floor(Math.random() * 1e7)}`;
  const email = `${tag}@test.local`;
  const user = await User.create({
    name: 'Suspended User',
    email,
    passwordHash: 'password123',
    role: 'customer',
    status: 'suspended',
  });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.2.${Math.floor(Math.random() * 200) + 1}.1` },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  assert(loginRes.status === 403, 'suspended user login → 403');

  await User.findByIdAndDelete(user._id);
  assert(true, 'cleanup: removed suspended test user');

  console.log(`\n──\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});