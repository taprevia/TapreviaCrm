/**
 * P3.6 local reliability audit — failure, retry, stale-write, empty-state,
 * logging and background-job evidence.
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import { seed } from './test-phase4d10p3-write-api';
import { connectDB } from '@/lib/db';
import User from '@/models/User';

const BASE = process.env.P36_BASE || 'http://localhost:3520';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });
const expiredToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: -10 });
const EMPTY = '000000000000000000000099';
const emptyToken = jwt.sign({ userId: EMPTY, role: 'customer' }, JWT_SECRET, { expiresIn: '1h' });

type Result = { id: string; name: string; pass: boolean; evidence: string };
const results: Result[] = [];
let ip = 0;
const nextIp = () => `10.55.${Math.floor(ip / 200)}.${(ip++ % 200) + 1}`;

async function call(method: string, route: string, opts: { token?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': nextIp() };
  if (opts.token) { headers.cookie = `token=${opts.token}`; headers.origin = BASE; }
  if (opts.body !== undefined || opts.raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    redirect: 'manual',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, text, json, headers: res.headers };
}

function check(id: string, name: string, pass: boolean, evidence: string) {
  results.push({ id, name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} — ${evidence}`);
}

function noStack(text: string): boolean {
  return !/\n\s*at\s+\S+\(/.test(text) && !/Error: .+\n\s+at /.test(text);
}

async function main() {
  if (!JWT_SECRET) throw new Error('JWT_SECRET required');
  await seed();
  await connectDB();

  {
    const r = await call('POST', '/api/auth/login', { raw: '{broken' });
    check('R1', 'Malformed JSON → 400 without stack trace', r.status === 400 && noStack(r.text), `status=${r.status} stack=${!noStack(r.text)}`);
  }
  {
    const r = await call('GET', '/api/public/cards/does-not-exist-p36');
    check('R2', 'Missing resource → 404 JSON without stack trace', r.status === 404 && noStack(r.text), `status=${r.status}`);
  }
  {
    const r = await call('GET', '/api/settings', { token: expiredToken });
    check('R3', 'Expired session → 401 (not HTML redirect)', r.status === 401 && noStack(r.text), `status=${r.status}`);
  }
  {
    const first = await call('PATCH', '/api/review-management', {
      token: ownerToken,
      body: { general: { welcomeMessage: 'R1' }, content: { category: 'cafe' } },
    });
    const revision = Number((first.json as { revision?: string | number })?.revision ?? 0);
    const stale = await call('PATCH', '/api/review-management', {
      token: ownerToken,
      body: { general: { welcomeMessage: 'R2' }, revision: Math.max(0, revision - 1) },
    });
    const retry = await call('PATCH', '/api/review-management', {
      token: ownerToken,
      body: { general: { welcomeMessage: 'R3' }, revision },
    });
    check('R4', 'Stale write → 409, retry with current revision → 200', stale.status === 409 && retry.status === 200, `stale=${stale.status} retry=${retry.status} revision=${revision}`);
  }
  {
    const r = await call('POST', '/api/public/reviews/p35-grc/generate', { body: { feedback: 'The coffee was excellent and the staff were kind.' } });
    check('R5', 'AI provider unavailable → 503 controlled', r.status === 503 && (r.json as { code?: string })?.code === 'UNAVAILABLE', `status=${r.status}`);
  }
  {
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(EMPTY) },
      {
        $set: {
          name: 'P36 Empty', email: 'empty@p36.test', role: 'customer', status: 'active',
          passwordHash: 'x'.repeat(32), createdAt: new Date(), updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    const dash = await call('GET', '/dashboard', { token: emptyToken });
    const products = await call('GET', '/dashboard/products', { token: emptyToken });
    const noCrash = !dash.text.includes('Application error') && !products.text.includes('Application error');
    check('R6', 'Empty-state dashboard/products render without crash', dash.status === 200 && products.status === 200 && noCrash, `dash=${dash.status} products=${products.status} crash=${!noCrash}`);
  }
  {
    const missing = await call('GET', '/api/public/cards/nope-p36');
    const valid = await call('GET', '/api/public/cards/p35-premium');
    check('R7', 'Retry after failure succeeds', missing.status === 404 && valid.status === 200, `missing=${missing.status} valid=${valid.status}`);
  }
  {
    const first = await call('PATCH', '/api/review-management', {
      token: ownerToken,
      body: { content: { category: 'cafe' } },
    });
    const revision = Number((first.json as { revision?: string | number })?.revision ?? 0);
    const [a, b] = await Promise.all([
      call('PATCH', '/api/review-management', { token: ownerToken, body: { general: { welcomeMessage: 'A' }, revision } }),
      call('PATCH', '/api/review-management', { token: ownerToken, body: { general: { welcomeMessage: 'B' }, revision } }),
    ]);
    const codes = [a.status, b.status].sort();
    check('R8', 'Concurrent settings write → one 200, one 409', codes[0] === 200 && codes[1] === 409, `statuses=${codes.join(',')}`);
  }
  {
    const secret = (fs.readFileSync('.env.local', 'utf8').match(/^JWT_SECRET=(.*)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '');
    const logDir = path.dirname(process.env.EGRESS_GUARD_LOG ?? '/tmp/x.log');
    const logs = fs.existsSync(logDir)
      ? fs.readdirSync(logDir).filter((f) => /p36-srv-.*\.log$/.test(f)).map((f) => path.join(logDir, f))
      : [];
    let leaked = false;
    let rawToken = false;
    let password = false;
    for (const file of logs) {
      const text = fs.readFileSync(file, 'utf8');
      if (secret && text.includes(secret)) leaked = true;
      if (/token=[A-Za-z0-9._-]{20,}/.test(text)) rawToken = true;
      if (/password=[^&\s]+/i.test(text)) password = true;
    }
    check('R9', 'Server logs contain no JWT secret/raw token/password', !leaked && !rawToken && !password, `logs=${logs.length} secret=${leaked} token=${rawToken} password=${password}`);
  }
  {
    const files = fs.readdirSync('src', { withFileTypes: true });
    void files;
    const { execSync } = await import('node:child_process');
    const out = execSync("grep -rnE 'setInterval|node-cron|cron\\(|new Queue|worker_threads' src --include='*.ts' --include='*.tsx' || true").toString();
    const relevant = out.split('\n').filter((line) => line && !line.includes('toast.tsx') && !line.includes('analytics.ts') && !line.includes('forgot-password/page.tsx') && !line.includes('setInterval(() => {\n'));
    check('R10', 'No server background job/cron/worker scheduler in app code', relevant.length === 0, `matches=${relevant.length}`);
  }
  {
    const r = await call('GET', '/api/health');
    check('R11', 'Health endpoint reports DB up', r.status === 200 && (r.json as { db?: string })?.db === 'up', `status=${r.status} db=${(r.json as { db?: string })?.db}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== P3.6 RELIABILITY SUMMARY ===');
  console.log(JSON.stringify({ scenarios: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
  await mongoose.disconnect();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
