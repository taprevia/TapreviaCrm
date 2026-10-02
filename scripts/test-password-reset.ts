/**
 * Forgot-password / reset-password evidence suite.
 *
 * Runs against a live server (localhost:3000 by default) plus a direct DB
 * connection. Uses unique X-Forwarded-For IPs so per-IP buckets in
 * `ratecounters` don't disturb real sessions.
 *
 * Run with: MONGODB_URI=... JWT_SECRET=... npm run test:password-reset
 * (requires `npm run dev` or `next start` on BASE_URL; default :3000)
 */

import { connectDB } from '@/lib/db';
import User from '@/models/User';
import PasswordResetToken from '@/models/PasswordResetToken';
import { hashResetToken, mintResetToken } from '@/lib/password-reset';

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

const ipBase = Math.floor(Math.random() * 100) + 100;
let ipSeq = 0;
function freshIp(): string {
  ipSeq += 1;
  return `10.${ipBase}.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

function randomEmail(): string {
  return `pwreset${Math.floor(Math.random() * 1e9)}@test.local`;
}

type JsonBody = Record<string, unknown> | null;

async function post(
  path: string,
  body: unknown,
  ip: string
): Promise<{ status: number; body: JsonBody }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as JsonBody;
  return { status: res.status, body: parsed };
}

async function login(
  ip: string,
  email: string,
  password: string
): Promise<{ status: number; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  await res.json().catch(() => null);
  return { status: res.status, cookie };
}

async function run() {
  await connectDB();

  const email = randomEmail();
  const oldPassword = 'oldpass123';
  const user = await User.create({
    name: 'PW Reset Test',
    email,
    passwordHash: oldPassword,
    role: 'customer',
    status: 'active',
  });

  const suspendedEmail = randomEmail();
  const suspended = await User.create({
    name: 'PW Reset Suspended',
    email: suspendedEmail,
    passwordHash: 'p123456',
    role: 'customer',
    status: 'suspended',
  });

  console.log('  Forgot-password: enumeration-safe generic response');
  const known = await post('/api/auth/forgot-password', { email }, freshIp());
  assert(known.status === 200 && known.body?.success === true, 'known email → generic 200 {success:true}');

  const unknown = await post('/api/auth/forgot-password', { email: randomEmail() }, freshIp());
  assert(unknown.status === 200 && unknown.body?.success === true, 'unknown email → identical 200 {success:true}');
  assert(
    JSON.stringify(known.body) === JSON.stringify(unknown.body),
    'known/unknown responses are byte-identical (no enumeration)'
  );

  console.log('  Forgot-password: reset link/token creation');
  const tokenDoc = await PasswordResetToken.findOne({ userId: user._id, usedAt: null });
  assert(!!tokenDoc, 'hashed reset token row created for known user');
  if (tokenDoc) {
    assert(tokenDoc.expiresAt.getTime() > Date.now(), 'token expiry is in the future');
    assert(/^[a-f0-9]{64}$/.test(tokenDoc.tokenHash), 'only a sha256 hash (64 hex) is persisted');
  }

  const suspRes = await post('/api/auth/forgot-password', { email: suspendedEmail }, freshIp());
  assert(suspRes.status === 200 && suspRes.body?.success === true, 'suspended email → generic 200');
  const suspTokenCount = await PasswordResetToken.countDocuments({ userId: suspended._id });
  assert(suspTokenCount === 0, 'suspended account receives no reset token');

  console.log('  Forgot-password: rate limiting (10/15min per IP)');
  const hotIp = freshIp();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await post('/api/auth/forgot-password', { email: randomEmail() }, hotIp);
    statuses.push(r.status);
  }
  assert(statuses.length === 11, '11 forgot-password requests made');
  assert(statuses[10] === 429, '11th rapid forgot-password request → 429', JSON.stringify(statuses));

  console.log('  Reset-password: token consumption');
  const newPassword = 'brandnew123';

  const minted = await mintResetToken(user._id.toString());
  const okReset = await post(
    '/api/auth/reset-password',
    { token: minted.token, newPassword },
    freshIp()
  );
  assert(okReset.status === 200 && okReset.body?.success === true, 'valid token + new password → 200 {success:true}');

  const reused = await post(
    '/api/auth/reset-password',
    { token: minted.token, newPassword: 'another123' },
    freshIp()
  );
  assert(reused.status === 400 && reused.body?.code === 'BAD_REQUEST', 'reused token rejected (one-time use)');

  const bogus = await post(
    '/api/auth/reset-password',
    { token: 'a'.repeat(64), newPassword },
    freshIp()
  );
  assert(bogus.status === 400 && bogus.body?.code === 'BAD_REQUEST', 'unknown/bogus token rejected');

  const expiredMinted = await mintResetToken(user._id.toString());
  await PasswordResetToken.findOneAndUpdate(
    { tokenHash: hashResetToken(expiredMinted.token) },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } }
  );
  const expired = await post(
    '/api/auth/reset-password',
    { token: expiredMinted.token, newPassword },
    freshIp()
  );
  assert(expired.status === 400 && expired.body?.code === 'BAD_REQUEST', 'expired token rejected');

  console.log('  Reset-password: password actually changed + auth intact');
  const oldLogin = await login(freshIp(), email, oldPassword);
  assert(oldLogin.status === 401, 'old password no longer authenticates (401)');

  const newLogin = await login(freshIp(), email, newPassword);
  assert(newLogin.status === 200, 'new password authenticates (200)');

  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: newLogin.cookie },
  });
  const meBody = (await me.json().catch(() => null)) as JsonBody;
  const meUser = meBody?.user as Record<string, unknown> | undefined;
  assert(me.status === 200 && meUser?.email === email, '/api/auth/me works with the post-reset session');

  console.log('  Cleanup');
  await User.findByIdAndDelete(user._id);
  await User.findByIdAndDelete(suspended._id);
  await PasswordResetToken.deleteMany({ userId: { $in: [user._id, suspended._id] } });
  assert(true, 'removed test users and reset tokens');

  console.log(`\n──\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) console.error(`Failures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});