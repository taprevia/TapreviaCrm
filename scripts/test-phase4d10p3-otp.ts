/**
 * P3.9 — Email OTP password reset API / DB integration test.
 *
 * Requires:
 *   - app server running with RESEND_BASE_URL=http://127.0.0.1:3999,
 *     RESEND_API_KEY=synthetic, EMAIL_FROM=synthetic, NODE_ENV=production
 *   - MONGODB_URI=localhost, MONGODB_DB=<p39 test db>
 *
 * The script starts its own loopback mock Resend HTTP server on :3999.
 * No real email is sent and no external network is used.
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { seed } from './test-phase4d10p3-write-api';
import { connectDB } from '@/lib/db';
import PasswordResetOtp from '@/models/PasswordResetOtp';
import User from '@/models/User';
import { mintResetToken } from '@/lib/password-reset';
import { hashGrant } from '@/lib/services/password-reset-otp';

const BASE = process.env.P39_BASE || 'http://localhost:3526';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const OTHER = '000000000000000000000003';
const DISPOSABLE = '000000000000000000000004';
const DISPOSABLE2 = '000000000000000000000005';
const ADMIN = '000000000000000000000001';

const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const otherToken = jwt.sign({ userId: OTHER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign({ userId: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

type Mail = { to: string; subject: string; text: string };
const messages: Mail[] = [];
let failProvider = false;
let ip = 0;
const nextIp = () => `10.91.${Math.floor(ip / 200)}.${(ip++ % 200) + 1}`;
const results: Array<{ id: string; name: string; pass: boolean; evidence: string }> = [];

function check(id: string, name: string, pass: boolean, evidence: string) {
  results.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${evidence}`);
}

async function startMockResend() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf8');
      res.setHeader('content-type', 'application/json');
      if (req.url === '/__control/reset') {
        messages.length = 0;
        failProvider = false;
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/__control/fail') {
        failProvider = bodyText.trim() === 'true';
        res.end(JSON.stringify({ ok: true, failProvider }));
        return;
      }
      if (req.url === '/__control/messages') {
        res.end(JSON.stringify(messages));
        return;
      }
      if (req.method === 'POST' && req.url === '/emails') {
        if (failProvider) {
          res.statusCode = 500;
          res.end('{"name":"provider_error","message":"synthetic provider failure"}');
          return;
        }
        try {
          const payload = JSON.parse(bodyText) as { to?: string[] | string; subject?: string; text?: string };
          messages.push({
            to: Array.isArray(payload.to) ? String(payload.to[0] ?? '') : String(payload.to ?? ''),
            subject: String(payload.subject ?? ''),
            text: String(payload.text ?? ''),
          });
          res.end(JSON.stringify({ id: `mock_${messages.length}` }));
        } catch {
          res.statusCode = 400;
          res.end('{"name":"validation_error","message":"invalid json"}');
        }
        return;
      }
      res.statusCode = 404;
      res.end('{"name":"not_found"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(3999, '127.0.0.1', resolve));
  return server;
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = {
    'x-real-ip': opts.ip ?? nextIp(),
    'content-type': 'application/json',
  };
  if (opts.token) {
    headers.cookie = `token=${opts.token}`;
    headers.origin = BASE;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}

async function clearRate() {
  await mongoose.connection.collection('ratecounters').deleteMany({});
}

async function resetMock() {
  await fetch('http://127.0.0.1:3999/__control/reset');
}

async function setMockFail(value: boolean) {
  await fetch('http://127.0.0.1:3999/__control/fail', { method: 'POST', body: String(value) });
}

async function requestOtp(email: string, ipAddress?: string) {
  return call('POST', '/api/auth/password-reset/request-otp', { body: { email }, ip: ipAddress });
}

function otpFrom(mail: Mail): string {
  const match = /Your verification code is:\s*\n+\s*(\d{6})/i.exec(mail.text);
  if (!match) throw new Error(`OTP not found in mock email: ${mail.text.slice(0, 120)}`);
  return match[1];
}

async function issueAndGetOtp(email: string): Promise<{ otp: string; challenge: any }> {
  await clearRate();
  await resetMock();
  // Age prior challenges so the 60s cooldown does not suppress this scenario.
  await PasswordResetOtp.updateMany(
    { email },
    { $set: { sentAt: new Date(Date.now() - 120_000), createdAt: new Date(Date.now() - 120_000) } }
  );
  const res = await requestOtp(email);
  if (res.status !== 200) throw new Error(`request-otp ${res.status}: ${res.text}`);
  const mail = messages[messages.length - 1];
  if (!mail) throw new Error('mock provider received no OTP email');
  const otp = otpFrom(mail);
  const challenge = await PasswordResetOtp.findOne({ email }).sort({ createdAt: -1 });
  if (!challenge) throw new Error('OTP challenge row missing');
  return { otp, challenge };
}

async function main() {
  if (!process.env.MONGODB_DB?.includes('p39')) {
    throw new Error(`Refusing non-p39 database: ${process.env.MONGODB_DB}`);
  }
  await seed();
  await connectDB();
  const mock = await startMockResend();
  const OLD_PASSWORD = 'OwnerPass123!';
  const NEW_PASSWORD = 'OtpNewPass456!';

  try {
    // ── Request ───────────────────────────────────────────────────────────
    {
      const { otp, challenge } = await issueAndGetOtp('owner@p35.test');
      const last = messages[messages.length - 1];
      const res = await fetch('http://127.0.0.1:3999/__control/messages');
      const all = (await res.json()) as Mail[];
      check(
        'OTP-01',
        'Request OTP sends six-digit email and stores HMAC, not plaintext',
        all.length === 1 &&
          last.subject === 'Taprevia — Password Reset Verification Code' &&
          /^\d{6}$/.test(otp) &&
          challenge.otpHash !== otp &&
          challenge.otpHash.length === 64 &&
          challenge.email === 'owner@p35.test' &&
          !JSON.stringify(all).includes('grant'),
        `mails=${all.length} subject=${last.subject} hashLen=${challenge.otpHash.length}`
      );
    }
    {
      await clearRate();
      await resetMock();
      const res = await requestOtp('owner@p35.test');
      const cache = res.headers.get('cache-control') ?? '';
      const text = res.text;
      check(
        'OTP-03',
        'Request response is generic and no-store',
        res.status === 200 &&
          /if an account exists/i.test(String((res.json as any)?.message ?? '')) &&
          !/\b\d{6}\b/.test(text) &&
          !text.includes('grant') &&
          /no-store/i.test(cache),
        `status=${res.status} cache=${cache}`
      );
    }
    {
      await clearRate();
      await resetMock();
      const res = await requestOtp('nobody-p39@example.test');
      check(
        'OTP-04',
        'Unknown email returns identical generic response and sends nothing',
        res.status === 200 && messages.length === 0 && (await PasswordResetOtp.countDocuments({ email: 'nobody-p39@example.test' })) === 0,
        `status=${res.status} mails=${messages.length}`
      );
    }

    // ── Verify / complete ─────────────────────────────────────────────────
    let grant = '';
    let otpCode = '';
    {
      const issued = await issueAndGetOtp('owner@p35.test');
      otpCode = issued.otp;
      const wrong = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'owner@p35.test', otp: issued.otp === '000000' ? '000001' : '000000' },
      });
      const afterWrong = await PasswordResetOtp.findById(issued.challenge._id).lean<any>();
      check('OTP-05', 'Wrong OTP rejected and attempt recorded', wrong.status === 400 && afterWrong?.attempts === 1, `status=${wrong.status} attempts=${afterWrong?.attempts}`);

      const verified = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'owner@p35.test', otp: otpCode },
      });
      grant = String((verified.json as any)?.grant ?? '');
      const afterVerify = await PasswordResetOtp.findById(issued.challenge._id).lean<any>();
      check(
        'OTP-06',
        'Correct OTP issues grant; only grant hash stored',
        verified.status === 200 && grant.length === 64 && afterVerify?.verifiedAt && afterVerify?.grantHash !== grant && afterVerify?.grantHash?.length === 64,
        `status=${verified.status} grantLen=${grant.length}`
      );
      const cache = verified.headers.get('cache-control') ?? '';
      check('OTP-07', 'Verify response is no-store', /no-store/i.test(cache), `cache=${cache}`);
    }
    {
      const before = await User.findById(OWNER).lean<any>();
      const complete = await call('POST', '/api/auth/password-reset/complete', {
        body: { grant, newPassword: NEW_PASSWORD },
      });
      const after = await User.findById(OWNER).lean<any>();
      const loginNew = await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: NEW_PASSWORD } });
      const loginOld = await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: OLD_PASSWORD } });
      check(
        'OTP-08',
        'Complete updates password, new login works, old fails',
        complete.status === 200 && before?.passwordHash !== after?.passwordHash && loginNew.status === 200 && loginOld.status === 401,
        `complete=${complete.status} new=${loginNew.status} old=${loginOld.status}`
      );
      const replay = await call('POST', '/api/auth/password-reset/complete', {
        body: { grant, newPassword: 'AnotherPass789!' },
      });
      check('OTP-09', 'Grant replay rejected', replay.status === 400, `status=${replay.status}`);
    }
    {
      const reuse = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'owner@p35.test', otp: otpCode },
      });
      check('OTP-10', 'OTP cannot be verified twice', reuse.status === 400, `status=${reuse.status}`);
    }
    {
      await clearRate();
      const noGrant = await call('POST', '/api/auth/password-reset/complete', {
        body: { grant: 'a'.repeat(64), newPassword: 'NoGrantPass123!' },
      });
      check('OTP-11', 'Complete without a real grant rejected', noGrant.status === 400, `status=${noGrant.status}`);
    }

    // ── Expiry / attempts / resend ────────────────────────────────────────
    {
      const issued = await issueAndGetOtp('other@p35.test');
      await PasswordResetOtp.updateOne({ _id: issued.challenge._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'other@p35.test', otp: issued.otp },
      });
      check('OTP-12', 'Expired OTP rejected', expired.status === 400, `status=${expired.status}`);
    }
    {
      const issued = await issueAndGetOtp('disposable@p35.test');
      const wrongCode = issued.otp === '000000' ? '000001' : '000000';
      const wrongStatuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const wrong = await call('POST', '/api/auth/password-reset/verify-otp', {
          body: { email: 'disposable@p35.test', otp: wrongCode },
          ip: `10.94.1.${i + 1}`,
        });
        wrongStatuses.push(wrong.status);
      }
      const locked = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'disposable@p35.test', otp: issued.otp },
        ip: '10.94.1.6',
      });
      const stored = await PasswordResetOtp.findById(issued.challenge._id).lean<any>();
      check(
        'OTP-13',
        'Five wrong attempts lock the OTP even for the correct code',
        wrongStatuses.every((status) => status === 400) && locked.status === 400 && stored?.attempts === 5,
        `wrong=${wrongStatuses.join(',')} correctAfter=${locked.status} attempts=${stored?.attempts}`
      );
    }
    {
      await clearRate();
      await resetMock();
      const first = await requestOtp('disposable2@p35.test', '10.92.1.1');
      const second = await requestOtp('disposable2@p35.test', '10.92.1.2');
      const mails = messages.length;
      check(
        'OTP-14',
        'Resend cooldown enforced server-side',
        first.status === 200 && second.status === 200 && mails === 1 && Number((second.json as any)?.resendAfter ?? 0) > 0,
        `first=${first.status} second=${second.status} mails=${mails} after=${(second.json as any)?.resendAfter}`
      );
    }
    {
      await clearRate();
      await resetMock();
      const issued = await issueAndGetOtp('disposable@p35.test');
      await PasswordResetOtp.updateOne(
        { _id: issued.challenge._id },
        { $set: { sentAt: new Date(Date.now() - 120_000), createdAt: new Date(Date.now() - 120_000) } }
      );
      await clearRate();
      const resend = await requestOtp('disposable@p35.test', '10.92.2.1');
      const mails = messages.length;
      const old = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'disposable@p35.test', otp: issued.otp },
      });
      check(
        'OTP-15',
        'New OTP supersedes old; old code fails',
        resend.status === 200 && mails === 2 && old.status === 400,
        `resend=${resend.status} mails=${mails} old=${old.status}`
      );
    }

    // ── Provider failure preserves prior OTP ──────────────────────────────
    {
      await clearRate();
      await resetMock();
      const issued = await issueAndGetOtp('disposable2@p35.test');
      await PasswordResetOtp.updateOne(
        { _id: issued.challenge._id },
        { $set: { sentAt: new Date(Date.now() - 120_000), createdAt: new Date(Date.now() - 120_000) } }
      );
      await clearRate();
      await setMockFail(true);
      const failed = await requestOtp('disposable2@p35.test', '10.92.3.1');
      const mailsAfterFail = messages.length;
      await setMockFail(false);
      const oldStillWorks = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'disposable2@p35.test', otp: issued.otp },
      });
      check(
        'OTP-16',
        'Provider failure does not invalidate usable prior OTP',
        failed.status === 200 && mailsAfterFail === 1 && oldStillWorks.status === 200,
        `request=${failed.status} mails=${mailsAfterFail} oldVerify=${oldStillWorks.status}`
      );
    }

    // ── Concurrency / cross-account / expiry grant ────────────────────────
    {
      const issued = await issueAndGetOtp('other@p35.test');
      const [a, b] = await Promise.all([
        call('POST', '/api/auth/password-reset/verify-otp', { body: { email: 'other@p35.test', otp: issued.otp }, ip: '10.93.1.1' }),
        call('POST', '/api/auth/password-reset/verify-otp', { body: { email: 'other@p35.test', otp: issued.otp }, ip: '10.93.1.2' }),
      ]);
      const codes = [a.status, b.status].sort();
      check('OTP-17', 'Concurrent verification yields exactly one grant', codes[0] === 200 && codes[1] === 400, `statuses=${codes.join(',')}`);
    }
    {
      const issued = await issueAndGetOtp('other@p35.test');
      const cross = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'disposable@p35.test', otp: issued.otp },
      });
      check('OTP-18', 'Cross-account OTP rejected', cross.status === 400, `status=${cross.status}`);
    }
    {
      const issued = await issueAndGetOtp('other@p35.test');
      const verified = await call('POST', '/api/auth/password-reset/verify-otp', { body: { email: 'other@p35.test', otp: issued.otp } });
      const grantToken = String((verified.json as any)?.grant ?? '');
      await PasswordResetOtp.updateOne(
        { grantHash: hashGrant(grantToken) },
        { $set: { grantExpiresAt: new Date(Date.now() - 1000) } }
      );
      const expiredGrant = await call('POST', '/api/auth/password-reset/complete', { body: { grant: grantToken, newPassword: 'ExpiredGrant123!' } });
      check('OTP-19', 'Expired grant rejected', expiredGrant.status === 400, `status=${expiredGrant.status}`);
    }

    // ── Send limit + concurrent completion ────────────────────────────────
    {
      await clearRate();
      await resetMock();
      const email = 'limit-p39@example.test';
      await User.create({
        name: 'P39 Limit User',
        email,
        passwordHash: 'LimitPass123!',
        role: 'customer',
        status: 'active',
      });
      let sent = 0;
      for (let i = 0; i < 5; i += 1) {
        if (i > 0) {
          await PasswordResetOtp.updateMany(
            { email },
            { $set: { sentAt: new Date(Date.now() - 120_000), createdAt: new Date(Date.now() - 120_000) } }
          );
          const emailHash = createHash('sha256').update(email).digest('hex');
          const issueKey = createHash('sha256').update(`pr-otp-issue:${emailHash}`).digest('hex');
          await mongoose.connection.collection('ratecounters').deleteOne({ key: issueKey });
        }
        const res = await requestOtp(email, `10.94.2.${i + 1}`);
        if (res.status === 200 && messages.length > sent) sent = messages.length;
      }
      check(
        'OTP-24',
        'Maximum four issuances per 15 minutes (initial + three resends)',
        messages.length === 4,
        `mails=${messages.length}`
      );
    }
    {
      const issued = await issueAndGetOtp('other@p35.test');
      const verified = await call('POST', '/api/auth/password-reset/verify-otp', {
        body: { email: 'other@p35.test', otp: issued.otp },
      });
      const grantToken = String((verified.json as any)?.grant ?? '');
      const body = { grant: grantToken, newPassword: 'ConcurrentPass123!' };
      const [a, b] = await Promise.all([
        call('POST', '/api/auth/password-reset/complete', { body, ip: '10.94.3.1' }),
        call('POST', '/api/auth/password-reset/complete', { body, ip: '10.94.3.2' }),
      ]);
      const codes = [a.status, b.status].sort();
      const login = await call('POST', '/api/auth/login', { body: { email: 'other@p35.test', password: 'ConcurrentPass123!' } });
      check(
        'OTP-25',
        'Concurrent completion allows exactly one password reset',
        codes[0] === 200 && codes[1] === 400 && login.status === 200,
        `statuses=${codes.join(',')} login=${login.status}`
      );
    }

    // ── Legacy reset links + admin email reset remain compatible ──────────
    {
      await resetMock();
      const legacy = await mintResetToken(OTHER);
      const legacyReset = await call('POST', '/api/auth/reset-password', {
        body: { token: legacy.token, newPassword: 'LegacyStillWorks123!' },
      });
      check('OTP-20', 'Legacy reset-link endpoint still works', legacyReset.status === 200, `status=${legacyReset.status}`);
    }
    {
      await resetMock();
      const adminReset = await call('POST', `/api/admin/users/${DISPOSABLE}/reset-password`, {
        token: adminToken,
        body: { mode: 'email' },
      });
      const legacyMail = messages.find((m) => m.text.includes('/reset-password?token='));
      check(
        'OTP-21',
        'Admin reset-by-email preserved and still sends a legacy link',
        adminReset.status === 200 && Boolean(legacyMail) && (legacyMail?.text.includes('/reset-password?token=') ?? false),
        `status=${adminReset.status} mails=${messages.length}`
      );
    }

    // ── Contract guards ───────────────────────────────────────────────────
    {
      const badEmail = await call('POST', '/api/auth/password-reset/request-otp', { body: { email: 'not-an-email' } });
      const badOtp = await call('POST', '/api/auth/password-reset/verify-otp', { body: { email: 'owner@p35.test', otp: '12' } });
      const badPass = await call('POST', '/api/auth/password-reset/complete', { body: { grant: 'a'.repeat(64), newPassword: 'short' } });
      check('OTP-22', 'Malformed email/OTP/password rejected with 400', [badEmail.status, badOtp.status, badPass.status].every((s) => s === 400), `statuses=${badEmail.status},${badOtp.status},${badPass.status}`);
    }
    {
      const source = await import('node:fs').then((fs) => fs.readFileSync('src/lib/services/password-reset-otp-http.ts', 'utf8'));
      const mailSource = await import('node:fs').then((fs) => fs.readFileSync('src/lib/mail.ts', 'utf8'));
      const logsOtp =
        /console\.[a-z]+\([^)]*\botp\b(?![-}\]]),?/.test(source) ||
        /console\.[a-z]+\([^)]*\botp\b(?![-}\]]),?/.test(mailSource);
      check('OTP-23', 'OTP/reset service never logs the OTP value', !logsOtp, `logsOtp=${logsOtp}`);
    }

    const failures = results.filter((r) => !r.pass);
    console.log('\n=== P3.9 OTP API SUMMARY ===');
    console.log(JSON.stringify({ scenarios: results.length, passed: results.length - failures.length, failed: failures.length, failures }, null, 2));
    await mongoose.disconnect();
    mock.close();
    process.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error);
    await mongoose.disconnect().catch(() => undefined);
    mock.close();
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
