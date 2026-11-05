/**
 * S24 missing-origin fallback for the security patch.
 *
 * Separate sanitized runtime without NEXT_PUBLIC_BASE_URL. Branded Standees
 * must stay on the picker and must not trust the request Host.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { MongoClient } from 'mongodb';

const URI = process.env.PHASE2A2_TEST_URI ?? '';
const DB = process.env.PHASE2A2_TEST_DB ?? '';
const BASE = process.env.PHASE2A2_BASE_URL ?? '';
const results: Array<{ id: string; status: 'PASS' | 'FAIL'; detail?: string }> = [];
let client: MongoClient;
let analytics: any;

function validate(): void {
  if (URI !== 'mongodb://127.0.0.1:27033') throw new Error('BLOCKED — wrong test URI');
  if (!/^taprevia_phase2a2_patch_[a-z0-9_]+$/.test(DB)) throw new Error('BLOCKED — wrong test DB');
  if (BASE !== 'http://127.0.0.1:3204') throw new Error('BLOCKED — wrong no-origin base URL');
}

async function request(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}

function rawRequest(path: string, headers: Record<string, string>) {
  return new Promise<{ status: number; location: string | null; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: 3204, path, method: 'GET', headers, timeout: 30000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: (res.headers.location as string) ?? null, body }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

const count = (metadata: string) => analytics.countDocuments({ metadata });

async function test(id: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ id, status: 'PASS' });
    console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, status: 'FAIL', detail: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL ${id} — ${results[results.length - 1].detail}`);
  }
}

async function main() {
  validate();
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  analytics = client.db(DB).collection('analyticslogs');

  await test('S24 missing origin keeps single Standee picker with no tap', async () => {
    const before = await count('route:r_ps_single');
    const res = await request('/patchstandee/standee');
    assert.equal(res.status, 200);
    assert.equal(res.location, null);
    assert.equal(await count('route:r_ps_single'), before);
  });

  await test('S24 missing origin keeps AIO3 picker with no tap', async () => {
    const before = await count('route:r_pa3');
    const res = await request('/patchaio3/standee');
    assert.equal(res.status, 200);
    assert.equal(res.location, null);
    assert.equal(await count('route:r_pa3'), before);
  });

  await test('S24 missing origin keeps review host picker with no tap', async () => {
    const before = await count('route:r_pr');
    const res = await request('/patchreview/standee');
    assert.equal(res.status, 200);
    assert.equal(res.location, null);
    assert.equal(await count('route:r_pr'), before);
  });

  await test('S24 request Host cannot become a trusted origin', async () => {
    const before = await count('route:r_ps_single');
    const res = await rawRequest('/patchstandee/standee', { Host: 'evil.test' });
    assert.equal(res.status, 200);
    assert.equal(res.location, null);
    assert.doesNotMatch(res.body, /evil\.test/);
    assert.equal(await count('route:r_ps_single'), before);
  });

  const failures = results.filter((r) => r.status === 'FAIL');
  console.log(JSON.stringify({ database: DB, passed: results.length - failures.length, failed: failures.length, results }, null, 2));
  await client.close();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(`NO-ORIGIN TEST BLOCKED/FAILED — ${error instanceof Error ? error.message : String(error)}`);
  try { await client?.close(); } catch {}
  process.exit(1);
});
