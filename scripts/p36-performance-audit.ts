/**
 * P3.6 local performance audit.
 *
 * - CDP field metrics on representative pages (mobile viewport, 4x CPU, slow 4G)
 * - API latency (median/p95/error rate)
 * - Client bundle size / largest chunks
 * - MongoDB explain() on representative queries with synthetic volume
 * - Server RSS before/after a bounded request burst
 *
 * Lighthouse is not installed/cached; its scores are reported NOT VERIFIED.
 */

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { connectDB } from '@/lib/db';
import AnalyticsLog from '@/models/AnalyticsLog';
import Inquiry from '@/models/Inquiry';
import UserProduct from '@/models/UserProduct';
import Card from '@/models/Card';
import User from '@/models/User';
import ReviewTemplate from '@/models/ReviewTemplate';
import Standee from '@/models/Standee';

const BASE = process.env.P36_BASE || 'http://localhost:3520';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const ADMIN = '000000000000000000000001';
const GRC = '000000000000000000000203';
const ownerToken = jwt.sign({ userId: OWNER, role: 'customer' }, JWT_SECRET, { expiresIn: '2h' });
const adminToken = jwt.sign({ userId: ADMIN, role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pages: Array<[string, string, string]> = [
  ['/', 'public', 'Landing'],
  ['/login', 'public', 'Login'],
  ['/dashboard', 'customer', 'Dashboard'],
  ['/dashboard/products', 'customer', 'My Products'],
  ['/admin', 'admin', 'Admin Dashboard'],
  [`/admin/users/${OWNER}`, 'admin', 'Admin User Details'],
  ['/dashboard/review-management', 'customer', 'Review Management'],
  ['/review/p35-grc', 'public', 'Public Review'],
  ['/dashboard/standees', 'customer', 'Standee'],
  ['/p35/premium', 'public', 'Public Profile'],
];

async function apiLatency() {
  const endpoints: Array<{ name: string; method: string; route: string; token?: string; body?: unknown }> = [
    { name: 'health', method: 'GET', route: '/api/health' },
    { name: 'auth-me', method: 'GET', route: '/api/auth/me', token: ownerToken },
    { name: 'my-products', method: 'GET', route: '/api/my/products', token: ownerToken },
    { name: 'cards', method: 'GET', route: '/api/cards', token: ownerToken },
    { name: 'review-management', method: 'GET', route: '/api/review-management', token: ownerToken },
    { name: 'analytics', method: 'GET', route: `/api/analytics?cardId=${GRC}`, token: ownerToken },
    { name: 'public-card', method: 'GET', route: '/api/public/cards/p35-premium' },
    { name: 'review-suggestions', method: 'POST', route: '/api/public/reviews/p35-grc/suggestions', body: { init: true } },
    { name: 'admin-users', method: 'GET', route: '/api/admin/users', token: adminToken },
    { name: 'admin-user-detail', method: 'GET', route: `/api/admin/users/${OWNER}`, token: adminToken },
  ];
  const results: Array<{ name: string; samples: number; median: number; p95: number; errors: number; bytes: number }> = [];
  let ip = 0;
  for (const endpoint of endpoints) {
    const times: number[] = [];
    let errors = 0;
    let bytes = 0;
    for (let i = 0; i < 20; i += 1) {
      const headers: Record<string, string> = { 'x-real-ip': `10.88.${Math.floor(ip / 200)}.${(ip++ % 200) + 1}` };
      if (endpoint.token) headers.cookie = `token=${endpoint.token}`;
      if (endpoint.body) headers['content-type'] = 'application/json';
      const start = performance.now();
      try {
        const res = await fetch(`${BASE}${endpoint.route}`, {
          method: endpoint.method,
          headers,
          body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
        });
        const buf = await res.arrayBuffer();
        bytes += buf.byteLength;
        if (res.status >= 400) errors += 1;
      } catch {
        errors += 1;
      }
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
    results.push({ name: endpoint.name, samples: times.length, median: Math.round(median * 10) / 10, p95: Math.round(p95 * 10) / 10, errors, bytes });
  }
  return results;
}

function bundleReport() {
  const root = '.next/static/chunks';
  const files = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const p = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return fs.readdirSync(p).filter((f) => f.endsWith('.js')).map((f) => path.join(p, f));
        }
        return entry.name.endsWith('.js') ? [p] : [];
      })
    : [];
  const rows = files.map((file) => {
    const buf = fs.readFileSync(file);
    return { file, raw: buf.byteLength, gzip: zlib.gzipSync(buf).byteLength };
  }).sort((a, b) => b.raw - a.raw);
  return {
    files: rows.length,
    rawTotal: rows.reduce((s, r) => s + r.raw, 0),
    gzipTotal: rows.reduce((s, r) => s + r.gzip, 0),
    largest: rows.slice(0, 10),
  };
}

async function dbExplain() {
  await Promise.all([
    AnalyticsLog.syncIndexes(),
    Inquiry.syncIndexes(),
    UserProduct.syncIndexes(),
    Card.syncIndexes(),
    User.syncIndexes(),
    ReviewTemplate.syncIndexes(),
    Standee.syncIndexes(),
  ]);
  const now = new Date();
  const logs = await AnalyticsLog.countDocuments();
  if (logs < 5000) {
    await AnalyticsLog.insertMany(
      Array.from({ length: 5000 }, () => ({
        cardId: new mongoose.Types.ObjectId(GRC),
        action: 'link_click',
        metadata: 'p36-volume',
        ip: '10.0.0.1',
        userAgent: 'p36',
        timestamp: now,
      })),
      { ordered: false }
    ).catch(() => undefined);
  }
  const inquiries = await Inquiry.countDocuments();
  if (inquiries < 1000) {
    await Inquiry.insertMany(
      Array.from({ length: 1000 }, () => ({
        cardId: new mongoose.Types.ObjectId(GRC),
        userId: new mongoose.Types.ObjectId(OWNER),
        name: 'P36 Volume',
        email: 'volume@p36.test',
        phone: '',
        message: 'volume',
        attachmentUrl: '',
        source: 'contact_form',
        status: 'new',
        notes: [],
        createdAt: now,
        updatedAt: now,
      })),
      { ordered: false }
    ).catch(() => undefined);
  }
  const checks = [
    ['card-by-alias', Card.collection.find({ urlAlias: 'p35-grc' })],
    ['user-by-email', User.collection.find({ email: 'owner@p35.test' })],
    ['analytics-by-card', AnalyticsLog.collection.find({ cardId: new mongoose.Types.ObjectId(GRC) }).sort({ timestamp: -1 }).limit(50)],
    ['inquiries-by-user', Inquiry.collection.find({ userId: new mongoose.Types.ObjectId(OWNER) }).sort({ createdAt: -1 }).limit(50)],
    ['assignments-by-user', UserProduct.collection.find({ userId: new mongoose.Types.ObjectId(OWNER), status: 'active' })],
    ['templates-by-category', ReviewTemplate.collection.find({ categoryKey: 'cafe', active: true })],
    ['standee-by-route', Standee.collection.find({ routeSlug: 'p35-standee' })],
  ] as const;
  const out: Array<{ name: string; ms: number; docs: number; keys: number; index: string }> = [];
  for (const [name, cursor] of checks) {
    const explain = await (cursor as unknown as { explain: (v: string) => Promise<any> }).explain('executionStats');
    const stats = explain.executionStats ?? {};
    const winning = explain.queryPlanner?.winningPlan ?? {};
    const indexName =
      winning.inputStage?.indexName ??
      winning.inputStage?.inputStage?.indexName ??
      winning.indexName ??
      (explain.queryPlanner?.winningPlan?.stage === 'COLLSCAN' ? 'COLLSCAN' : 'unknown');
    out.push({
      name,
      ms: Number(stats.executionTimeMillis ?? 0),
      docs: Number(stats.totalDocsExamined ?? 0),
      keys: Number(stats.totalKeysExamined ?? 0),
      index: String(indexName),
    });
  }
  return out;
}

async function rss(pid: number): Promise<number> {
  try {
    return Math.round(Number(fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? 0));
  } catch {
    return 0;
  }
}

async function main() {
  if (!JWT_SECRET) throw new Error('JWT_SECRET required');
  await connectDB();

  const latency = await apiLatency();
  const bundle = bundleReport();
  const explain = await dbExplain();

  // Server RSS via ps (macOS).
  const serverPid = Number((await import('node:child_process')).execSync(`lsof -tiTCP:${new URL(BASE).port || '80'} -sTCP:LISTEN | head -1`).toString().trim());
  const rssBefore = Number((await import('node:child_process')).execSync(`ps -o rss= -p ${serverPid}`).toString().trim());
  for (let i = 0; i < 200; i += 1) {
    await fetch(`${BASE}/api/health`, { headers: { 'x-real-ip': `10.66.${Math.floor(i / 200)}.${(i % 200) + 1}` } });
  }
  await sleep(500);
  const rssAfter = Number((await import('node:child_process')).execSync(`ps -o rss= -p ${serverPid}`).toString().trim());

  // Browser metrics.
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p36perf-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9272', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  const pageMetrics: Array<Record<string, unknown>> = [];
  let blockedExternal = 0;
  const blockedExternalUrls: string[] = [];
  try {
    for (let i = 0; i < 100; i += 1) {
      try { await (await fetch('http://127.0.0.1:9272/json/version')).json(); break; } catch { await sleep(200); }
    }
    const target = (await (await fetch('http://127.0.0.1:9272/json/new?about:blank', { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { ws.onopen = () => resolve(); ws.onerror = () => reject(new Error('cdp')); });
    let id = 0;
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
      const current = ++id;
      pending.set(current, { resolve, reject });
      ws.send(JSON.stringify({ id: current, method, params }));
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number; method?: string; params?: any; result?: unknown; error?: unknown };
      if (msg.method === 'Fetch.requestPaused') {
        const url = String(msg.params?.request?.url ?? '');
        if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) {
          void send('Fetch.continueRequest', { requestId: msg.params?.requestId });
        } else {
          blockedExternal += 1;
          if (blockedExternalUrls.length < 5) blockedExternalUrls.push(url);
          void send('Fetch.failRequest', { requestId: msg.params?.requestId, errorReason: 'BlockedByClient' });
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
    };
    const ev = async <T = unknown>(expression: string): Promise<T> => {
      const r = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as { result?: { value?: T } };
      return r.result?.value as T;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__p36={lcp:0,cls:0,tbt:0,longtasks:0};
        try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__p36.lcp=Math.max(window.__p36.lcp,e.startTime)}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}
        try{new PerformanceObserver(l=>{for(const e of l.getEntries()){if(!e.hadRecentInput)window.__p36.cls+=e.value}}).observe({type:'layout-shift',buffered:true})}catch(e){}
        try{new PerformanceObserver(l=>{for(const e of l.getEntries()){window.__p36.longtasks++;window.__p36.tbt+=Math.max(0,e.duration-50)}}).observe({type:'longtask',buffered:true})}catch(e){}`,
    });

    for (const [route, role] of pages) {
      const samples: Array<Record<string, number>> = [];
      for (let run = 0; run < 2; run += 1) {
        await send('Network.clearBrowserCookies');
        if (role !== 'public') {
          await send('Network.setCookie', {
            name: 'token',
            value: role === 'admin' ? adminToken : ownerToken,
            url: BASE,
            path: '/',
          });
        }
        await send('Page.navigate', { url: `${BASE}${route}` });
        await sleep(4500);
        const m = await ev<Record<string, number>>(`(() => {
          const nav = performance.getEntriesByType('navigation')[0] || {};
          const paints = performance.getEntriesByType('paint');
          const fcp = paints.find(p => p.name === 'first-contentful-paint')?.startTime || 0;
          const res = performance.getEntriesByType('resource');
          const transfer = res.reduce((s, r) => s + (r.transferSize || 0), 0);
          return {
            fcp: Math.round(fcp),
            lcp: Math.round(window.__p36.lcp),
            cls: Math.round(window.__p36.cls * 1000) / 1000,
            tbt: Math.round(window.__p36.tbt),
            longtasks: window.__p36.longtasks,
            dcl: Math.round(nav.domContentLoadedEventEnd || 0),
            load: Math.round(nav.loadEventEnd || 0),
            transfer,
            resources: res.length,
            doc: Math.round(nav.transferSize || 0),
          };
        })()`);
        samples.push(m as Record<string, number>);
      }
      const median = (key: string) => {
        const vals = samples.map((s) => Number(s[key] ?? 0)).sort((a, b) => a - b);
        return Math.round(((vals[0] + vals[1]) / 2) * 100) / 100;
      };
      pageMetrics.push({
        route,
        name: pages.find((p) => p[0] === route)?.[2],
        fcp: median('fcp'),
        lcp: median('lcp'),
        cls: median('cls'),
        tbt: median('tbt'),
        longtasks: median('longtasks'),
        dcl: median('dcl'),
        load: median('load'),
        transfer: median('transfer'),
        resources: median('resources'),
      });
    }
    ws.close();
  } finally {
    chrome.kill('SIGTERM');
    await sleep(300);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\n=== P3.6 PERFORMANCE SUMMARY ===');
  console.log(JSON.stringify({
    environment: {
      base: BASE,
      viewport: '390x844 dpr2',
      cpuThrottle: '4x',
      network: '150ms RTT, 1.6Mbps down, 750kbps up',
      cache: 'disabled',
      runsPerPage: 2,
      externalRequestsBlocked: blockedExternal,
      externalRequestSamples: blockedExternalUrls,
    },
    lighthouse: 'NOT VERIFIED — lighthouse is not installed/cached locally',
    api: latency,
    bundle: { files: bundle.files, rawTotal: bundle.rawTotal, gzipTotal: bundle.gzipTotal, largest: bundle.largest.slice(0, 5) },
    dbExplain: explain,
    memory: { rssBeforeKb: rssBefore, rssAfterKb: rssAfter, deltaKb: rssAfter - rssBefore, requests: 200 },
    pages: pageMetrics,
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
