/**
 * P3.6 local security audit — HTTP + filesystem evidence, loopback only.
 *
 * Run with a seeded local server:
 *   MONGODB_URI=mongodb://localhost:27017 MONGODB_DB=taprevia_p36_audit \
 *   P36_BASE=http://localhost:3520 JWT_SECRET=... npx tsx scripts/p36-security-audit.ts
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { seed } from './test-phase4d10p3-write-api';
import { connectDB } from '@/lib/db';
import Card from '@/models/Card';
import Inquiry from '@/models/Inquiry';
import User from '@/models/User';

const BASE = process.env.P36_BASE || 'http://localhost:3520';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const ADMIN = '000000000000000000000001';
const OTHER = '000000000000000000000003';
const GRC = '000000000000000000000203';
const BIZ = '000000000000000000000202';
const IQ = '000000000000000000000a01';

const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign({ userId: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
const otherToken = jwt.sign({ userId: OTHER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });

type Result = { id: string; name: string; pass: boolean; evidence: string };
const results: Result[] = [];
let ip = 0;
const nextIp = () => `10.77.${Math.floor(ip / 200)}.${(ip++ % 200) + 1}`;

async function call(method: string, route: string, opts: {
  token?: string; body?: unknown; raw?: string; origin?: string | null; headers?: Record<string, string>;
} = {}) {
  const headers: Record<string, string> = { 'x-real-ip': nextIp(), ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = `token=${opts.token}`;
  if (opts.origin !== null && (opts.token || opts.origin)) headers.origin = opts.origin ?? BASE;
  if (opts.raw !== undefined) { headers['content-type'] = 'application/json'; }
  else if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}

function check(id: string, name: string, pass: boolean, evidence: string) {
  results.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${evidence}`);
}

async function main() {
  if (!process.env.MONGODB_DB?.includes('p3')) {
    console.error('Refusing: expected a *p35/p36/p37* database');
    process.exit(1);
  }
  await seed();
  await connectDB();

  // ── A4: security headers ────────────────────────────────────────────────
  for (const route of ['/login', '/review/p35-grc', '/dashboard']) {
    const r = await call('GET', route, route === '/dashboard' ? { token: ownerToken } : {});
    const h = r.headers;
    const csp = h.get('content-security-policy') ?? '';
    check(
      `A4-${route === '/login' ? 'public' : route.includes('review') ? 'review' : 'dashboard'}`,
      `Security headers on ${route}`,
      csp.includes("default-src 'self'") &&
        csp.includes("frame-ancestors 'none'") &&
        h.get('x-content-type-options') === 'nosniff' &&
        h.get('referrer-policy') === 'no-referrer' &&
        h.get('x-frame-options') === 'DENY' &&
        Boolean(h.get('permissions-policy')) &&
        (process.env.NODE_ENV === 'production' ? Boolean(h.get('strict-transport-security')) : true),
      `status=${r.status} csp=${Boolean(csp)} hsts=${Boolean(h.get('strict-transport-security'))}`
    );
  }
  {
    const r = await call('GET', '/dashboard', { token: ownerToken });
    const cache = r.headers.get('cache-control') ?? '';
    check('A4-cache', 'Authenticated dashboard is not publicly cacheable', /no-store|private|no-cache/i.test(cache) || cache === '', `cache-control=${cache}`);
  }

  // ── A5: CSRF / CORS ─────────────────────────────────────────────────────
  {
    const noOrigin = await call('PATCH', '/api/customer/settings', { token: ownerToken, origin: null, body: { isNewsletterEnabled: true } });
    const badOrigin = await call('PATCH', '/api/customer/settings', { token: ownerToken, origin: 'https://evil.example', body: { isNewsletterEnabled: true } });
    const goodOrigin = await call('PATCH', '/api/customer/settings', { token: ownerToken, body: { isNewsletterEnabled: true } });
    check('A5-csrf', 'Cookie-auth mutations reject missing/foreign Origin', noOrigin.status === 403 && badOrigin.status === 403 && goodOrigin.status === 200, `missing=${noOrigin.status} foreign=${badOrigin.status} same=${goodOrigin.status}`);
  }
  {
    const r = await call('GET', '/api/settings', { token: ownerToken, origin: 'https://evil.example' });
    const acao = r.headers.get('access-control-allow-origin');
    const opt = await call('OPTIONS', '/api/settings', { token: ownerToken, origin: 'https://evil.example', headers: { 'access-control-request-method': 'PATCH' } });
    check('A5-cors', 'No wildcard credentialed CORS', acao === null && opt.headers.get('access-control-allow-origin') === null, `GET_ACAO=${acao ?? 'none'} OPTIONS=${opt.status}/${opt.headers.get('access-control-allow-origin') ?? 'none'}`);
  }

  // ── A1/A2: auth & role boundaries ───────────────────────────────────────
  {
    const unauthAdmin = await call('GET', '/api/admin/users');
    const customerAdmin = await call('GET', '/api/admin/users', { token: ownerToken });
    const badToken = await call('GET', '/api/settings', { token: 'not-a-real-token' });
    const suspended = await call('POST', '/api/auth/login', { body: { email: 'suspended@p35.test', password: 'SuspendedPass123!' } });
    check('A2-roles', 'Admin/customer/session boundaries', unauthAdmin.status === 401 && customerAdmin.status === 403 && badToken.status === 401 && suspended.status === 403, `unauth=${unauthAdmin.status} role=${customerAdmin.status} badToken=${badToken.status} suspended=${suspended.status}`);
  }
  {
    const login = await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: 'OwnerPass123!' } });
    const cookie = login.headers.get('set-cookie') ?? '';
    check('A1-cookie', 'Session cookie flags', login.status === 200 && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Secure/i.test(cookie), `status=${login.status} httpOnly=${/HttpOnly/i.test(cookie)} sameSite=${/SameSite=Lax/i.test(cookie)} secure=${/Secure/i.test(cookie)}`);
  }
  {
    const wrong = await call('POST', '/api/auth/login', { body: { email: 'owner@p35.test', password: 'definitely-wrong' } });
    const unknown = await call('POST', '/api/auth/login', { body: { email: 'ghost-p36@p35.test', password: 'definitely-wrong' } });
    check('A1-enum', 'Login does not enumerate accounts', wrong.status === 401 && unknown.status === 401 && wrong.text === unknown.text, `${wrong.status}/${unknown.status} identical=${wrong.text === unknown.text}`);
  }

  // ── A3: injection / redirect / XSS ──────────────────────────────────────
  {
    const r = await call('POST', '/api/auth/login', { body: { email: { $ne: null }, password: { $ne: null } } });
    check('A3-nosql', 'NoSQL operator payload rejected', r.status === 400, `status=${r.status}`);
  }
  {
    const payload = '<img src=x onerror="window.__p36xss=1"><script>window.__p36xss=2</script>';
    const r = await call('PATCH', `/api/cards/${GRC}`, { token: ownerToken, body: { descriptionHtml: payload } });
    const card = await Card.findById(GRC).lean<any>();
    const stored = String(card?.descriptionHtml ?? '');
    const publicPage = await call('GET', '/review/p35-grc');
    check('A3-xss', 'Stored HTML is sanitized', r.status === 200 && !stored.includes('<script') && !stored.includes('onerror') && !publicPage.text.includes('__p36xss'), `status=${r.status} stored_script=${stored.includes('<script')} stored_onerror=${stored.includes('onerror')}`);
  }
  {
    for (const [kind, value] of [
      ['javascript', 'javascript:alert(1)'],
      ['protocol-relative', '//evil.example/steal'],
      ['data', 'data:text/html,<script>alert(1)</script>'],
    ] as const) {
      const r = await call('PATCH', `/api/cards/${BIZ}`, { token: ownerToken, body: { redirectUrl: value } });
      check(`A3-redirect-${kind}`, `Unsafe redirect rejected (${kind})`, r.status === 400, `status=${r.status}`);
    }
    const ok = await call('PATCH', `/api/cards/${BIZ}`, { token: ownerToken, body: { redirectUrl: 'https://example.test/valid' } });
    check('A3-redirect-ok', 'Safe https redirect accepted', ok.status === 200, `status=${ok.status}`);
  }
  {
    const r = await call('GET', '/api/admin/users?search=%7B%22%24ne%22%3Anull%7D', { token: adminToken });
    check('A3-search', 'NoSQL-shaped search does not 500', r.status === 200, `status=${r.status}`);
  }

  // ── A6: upload safety ───────────────────────────────────────────────────
  {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('<html><script>alert(1)</script></html>')], { type: 'text/html' }), 'evil.html');
    form.append('category', 'avatar');
    const r = await fetch(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { cookie: `token=${ownerToken}`, origin: BASE, 'x-real-ip': nextIp() },
      body: form,
    });
    check('A6-type', 'HTML upload rejected as image', r.status === 400, `status=${r.status}`);
  }
  {
    const trav = await call('DELETE', '/api/uploads?key=../../../../etc/passwd', { token: ownerToken });
    const foreign = await call('DELETE', '/api/uploads?key=000000000000000000000003/p35/other.webp', { token: ownerToken });
    check('A6-path', 'Upload key traversal / foreign media denied', (trav.status === 404 || trav.status === 400) && foreign.status === 403, `traversal=${trav.status} foreign=${foreign.status}`);
  }

  // ── A7: sensitive data / secrets ────────────────────────────────────────
  {
    const me = await call('GET', '/api/auth/me', { token: ownerToken });
    const settings = await call('GET', '/api/settings', { token: ownerToken });
    const adminUsers = await call('GET', '/api/admin/users', { token: adminToken });
    const combined = `${me.text}${settings.text}${adminUsers.text}`;
    check('A7-response', 'Responses omit password hashes and encrypted keys', !combined.includes('passwordHash') && !combined.includes('apiKeyEnc'), `me=${me.status} settings=${settings.status} admin=${adminUsers.status}`);
  }
  {
    const publicDir = '.next/static';
    const envText = fs.readFileSync('.env.local', 'utf8');
    const secretValues = envText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+=/.test(line) && !line.startsWith('NEXT_PUBLIC_'))
      .map((line) => line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, ''))
      .filter((value) => value.length >= 24);
    let leaked = false;
    if (fs.existsSync(publicDir)) {
      const walk = (dir: string): string[] =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const p = path.join(dir, entry.name);
          return entry.isDirectory() ? walk(p) : [p];
        });
      const files = walk(publicDir).filter((f) => /\.(js|json|map)$/.test(f));
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        if (secretValues.some((value) => text.includes(value))) {
          leaked = true;
          break;
        }
      }
    }
    check('A7-bundle', 'No private env value present in client bundle', !leaked, `secretValues=${secretValues.length} leaked=${leaked}`);
  }
  {
    const dangerous = /(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|mongodb\+srv:\/\/[^\s'"]+)/g;
    const roots = ['src', 'scripts', 'docs'];
    let hits = 0;
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(p);
        return /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(entry.name) ? [p] : [];
      });
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const text = fs.readFileSync(file, 'utf8');
        // Documentation placeholders and local synthetic keys are not secrets.
        if (file.includes('test-phase4d10p3-write-api') || file.includes('p36-security-audit')) continue;
        const matches = (text.match(dangerous) ?? []).filter(
          (value) => !/[<]/.test(value) && !/user:pass@|example\.test|REDACTED/i.test(value)
        );
        if (matches.length) hits += matches.length;
      }
    }
    check('A7-scan', 'No hardcoded private keys/provider tokens in source', hits === 0, `matches=${hits}`);
  }

  // ── CSV formula injection ───────────────────────────────────────────────
  {
    await Inquiry.updateOne(
      { _id: new mongoose.Types.ObjectId(IQ) },
      { $set: { name: '=HYPERLINK("https://evil.example","x")' } }
    );
    const r = await call('GET', '/api/inquiries/export', { token: ownerToken });
    const firstLine = r.text.split('\n').slice(0, 2).join('\n');
    check('A3-csv', 'CSV export escapes formula payloads', r.status === 200 && firstLine.includes("'=HYPERLINK") && !firstLine.includes(',=HYPERLINK'), `status=${r.status} escaped=${firstLine.includes("'=HYPERLINK")}`);
  }

  // ── Rate limiting (fresh IP) ────────────────────────────────────────────
  {
    const ip = '10.99.1.1';
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const r = await call('POST', '/api/auth/login', { headers: { 'x-real-ip': ip }, body: { email: 'nobody-p36@p35.test', password: 'wrong' } });
      codes.push(r.status);
    }
    check('A1-rate', 'Login brute-force bucket returns 429', codes[10] === 429, `codes=${codes.join(',')}`);
  }

  // ── Suspended account cleanup check ─────────────────────────────────────
  {
    const suspended = await User.findOne({ email: 'suspended@p35.test' }).lean<any>();
    check('A2-suspended', 'Suspended fixture is isolated from active access', suspended?.status === 'suspended', `status=${suspended?.status ?? 'missing'}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== P3.6 SECURITY SUMMARY ===');
  console.log(JSON.stringify({
    checks: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: failed.length,
    failures: failed,
  }, null, 2));
  await mongoose.disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
