/**
 * P3.9 — Email OTP password reset browser workflow.
 *
 * Requires the app server running with RESEND_BASE_URL=http://127.0.0.1:3999
 * and RESEND_API_KEY/EMAIL_FROM synthetic. This script owns the mock provider
 * and never sends a real email.
 */

import http from 'node:http';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seed } from './test-phase4d10p3-write-api';
import mongoose from 'mongoose';

const BASE = process.env.P39_BASE || 'http://localhost:3526';
const JWT_SECRET = process.env.JWT_SECRET as string;
const OWNER = '000000000000000000000002';
const OTHER = '000000000000000000000003';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const results: Array<{ id: string; action: string; pass: boolean; evidence: string }> = [];
const AXE = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');

type Mail = { to: string; subject: string; text: string };
const messages: Mail[] = [];

function record(id: string, action: string, pass: boolean, evidence: string) {
  results.push({ id, action, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${action} — ${evidence}`);
}

async function startMock() {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/__control/reset') {
        messages.length = 0;
        res.end('{"ok":true}');
        return;
      }
      if (req.url === '/__control/messages') {
        res.end(JSON.stringify(messages));
        return;
      }
      if (req.method === 'POST' && req.url === '/emails') {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          to?: string[] | string; subject?: string; text?: string;
        };
        messages.push({
          to: Array.isArray(payload.to) ? String(payload.to[0] ?? '') : String(payload.to ?? ''),
          subject: String(payload.subject ?? ''),
          text: String(payload.text ?? ''),
        });
        res.end(JSON.stringify({ id: `ui_${messages.length}` }));
        return;
      }
      res.statusCode = 404;
      res.end('{"name":"not_found"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(3999, '127.0.0.1', resolve));
  return server;
}

function otpFrom(mail: Mail): string {
  const match = /Your verification code is:\s*\n+\s*(\d{6})/i.exec(mail.text);
  if (!match) throw new Error('OTP missing from mock email');
  return match[1];
}

async function main() {
  if (!process.env.MONGODB_DB?.includes('p39')) throw new Error('Refusing non-p39 database');
  await seed();
  const mock = await startMock();

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p39ui-'));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9278', `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    for (let i = 0; i < 100; i += 1) {
      try { await (await fetch('http://127.0.0.1:9278/json/version')).json(); break; } catch { await sleep(200); }
    }
    const target = (await (await fetch('http://127.0.0.1:9278/json/new?about:blank', { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
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
      const msg = JSON.parse(String((event as MessageEvent).data)) as { id?: number; result?: unknown; error?: unknown };
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
    const waitFor = async (expression: string, timeout = 8000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await ev<boolean>(`Boolean(${expression})`)) return true;
        await sleep(150);
      }
      return false;
    };
    const goto = async (route: string) => {
      await send('Network.clearBrowserCookies');
      await send('Page.navigate', { url: `${BASE}${route}` });
      await sleep(1600);
    };
    const setInput = async (selector: string, value: string) => {
      const ok = await ev<boolean>(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(150);
      return ok;
    };
    const click = async (text: string, selector = 'button,a') => {
      const ok = await ev<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => (n.innerText || '').trim().includes(${JSON.stringify(text)}));
        if (!el) return false; el.click(); return true;
      })()`);
      await sleep(500);
      return ok;
    };
    const axe = async (label: string) => {
      const out = await ev<any>(`axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } }).then(r => ({ violations: r.violations.length, details: r.violations.map(v => v.id) }))`);
      record(`UI-AXE-${label}`, `axe scan ${label}`, out?.violations === 0, `violations=${out?.violations ?? 'error'} ${JSON.stringify(out?.details ?? [])}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: AXE });

    // Step 1
    await goto('/forgot-password');
    record('UI-01', 'Open Forgot Password', await waitFor(`document.body.innerText.includes('Forgot Password?')`), `path=${await ev('location.pathname')}`);
    await axe('step1');

    await setInput('#reset-email', 'owner@p35.test');
    await click('Send OTP', 'button');
    const reachedOtp = await waitFor(`document.body.innerText.includes('Verify Your Email')`);
    const firstMail = messages[0];
    const otp = firstMail ? otpFrom(firstMail) : '';
    const focusOtp = await ev<string>('document.activeElement?.id ?? ""');
    record('UI-02', 'Send OTP advances to verification', reachedOtp && otp.length === 6, `step2=${reachedOtp} subject=${firstMail?.subject ?? 'none'}`);
    record('UI-03', 'OTP input receives focus; resend cooldown shown', focusOtp === 'reset-otp' && /Resend code in \d+s/.test(await ev<string>('document.body.innerText')), `focus=${focusOtp}`);
    await axe('step2');

    await setInput('#reset-otp', otp === '000000' ? '000001' : '000000');
    await click('Verify OTP', 'button');
    const wrongVisible = await waitFor(`document.body.innerText.includes('Invalid or expired')`);
    record('UI-04', 'Wrong OTP shows error and stays on step 2', wrongVisible && (await ev<boolean>(`Boolean(document.querySelector('#reset-otp'))`)), `error=${wrongVisible}`);

    await setInput('#reset-otp', otp);
    await click('Verify OTP', 'button');
    const reachedPassword = await waitFor(`document.body.innerText.includes('Create New Password')`);
    record('UI-05', 'Correct OTP advances to password step', reachedPassword, `step3=${reachedPassword}`);
    await axe('step3');

    await setInput('#new-password', 'UiOtpPass123!');
    await setInput('#confirm-password', 'Mismatch123!');
    await click('Reset Password', 'button');
    const mismatch = await waitFor(`document.body.innerText.includes('do not match')`);
    record('UI-06', 'Password mismatch rejected client-side', mismatch, `mismatch=${mismatch}`);

    await ev<boolean>(`document.querySelector('[aria-label="Show password"]')?.click(); true`);
    await sleep(250);
    const shown = await ev<boolean>(`document.querySelector('#new-password')?.type === 'text'`);
    record('UI-07', 'Password visibility toggle works', shown, `type=${await ev('document.querySelector("#new-password")?.type')}`);

    await setInput('#confirm-password', 'UiOtpPass123!');
    await click('Reset Password', 'button');
    const success = await waitFor(`document.body.innerText.includes('Password Reset Successfully')`);
    record('UI-08', 'Password reset succeeds', success, `success=${success}`);

    await click('Back to Login', 'a');
    const atLogin = await waitFor(`location.pathname === '/login'`);
    await setInput('#email', 'owner@p35.test');
    await setInput('#password', 'UiOtpPass123!');
    await click('Sign In', 'button');
    const loggedIn = await waitFor(`location.pathname === '/dashboard'`);
    record('UI-09', 'New password logs in from UI', atLogin && loggedIn, `login=${atLogin} dashboard=${loggedIn}`);

    // Change email + unknown email + responsive
    await goto('/forgot-password');
    await setInput('#reset-email', 'other@p35.test');
    await click('Send OTP', 'button');
    await waitFor(`document.body.innerText.includes('Verify Your Email')`);
    await click('Change Email', 'button');
    const backToEmail = await waitFor(`document.body.innerText.includes('Forgot Password?')`);
    record('UI-10', 'Change Email returns to step 1 and clears code', backToEmail && !(await ev<boolean>(`Boolean(document.querySelector('#reset-otp'))`)), `back=${backToEmail}`);

    const mailCountBefore = messages.length;
    await setInput('#reset-email', 'nobody-ui@p39.test');
    await click('Send OTP', 'button');
    const unknownAdvanced = await waitFor(`document.body.innerText.includes('Verify Your Email')`);
    record('UI-11', 'Unknown email gets generic next step and no email', unknownAdvanced && messages.length === mailCountBefore, `step2=${unknownAdvanced} mails=${messages.length}`);

    let overflow = 0;
    let checks = 0;
    for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      await goto('/forgot-password');
      checks += 1;
      if (await ev<boolean>('document.documentElement.scrollWidth > window.visualViewport.width + 1')) overflow += 1;
    }
    record('UI-12', 'Responsive layout has no horizontal overflow', overflow === 0, `${checks} widths overflow=${overflow}`);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await goto('/forgot-password');
    const zoomOverflow = await ev<boolean>(`(() => { document.documentElement.style.fontSize='200%'; return document.documentElement.scrollWidth > window.visualViewport.width + 1; })()`);
    record('UI-13', '200% text resize has no horizontal overflow', !zoomOverflow, `overflow=${zoomOverflow}`);

    const failed = results.filter((r) => !r.pass);
    console.log('\n=== P3.9 OTP UI SUMMARY ===');
    console.log(JSON.stringify({ workflows: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed }, null, 2));
    ws.close();
    await mongoose.disconnect();
    mock.close();
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error);
    await mongoose.disconnect().catch(() => undefined);
    mock.close();
    process.exit(1);
  } finally {
    chrome.kill('SIGTERM');
    await sleep(200);
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
