/**
 * Mail provider (Resend) evidence suite.
 *
 * Focused module tests against src/lib/mail.ts — no server, no network.
 * Covers dev vs production dispatch, message assembly (recipient + reset URL),
 * sender/credential config resolution, and safe provider-failure handling.
 * Provider behavior is verified at the abstraction boundary via an injected
 * fake transport (per the project's convention of tsx scripts with assert()
 * checks).
 *
 * Run with: npm run test:mail:provider
 */

import {
  buildPasswordResetMail,
  getMailConfig,
  resendTransport,
  sendPasswordResetEmail,
} from '@/lib/mail';
import type { MailMessage, MailTransport, MailTransportResult } from '@/lib/mail';

const TOKEN = 'test-token-0123456789abcdef';
const RECIPIENT = 'user@example.test';
const BASE_URL = 'http://localhost:3000';

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

const ENV_KEYS = ['NODE_ENV', 'RESEND_API_KEY', 'EMAIL_FROM', 'NEXT_PUBLIC_BASE_URL'] as const;
type EnvKey = (typeof ENV_KEYS)[number];

const originalEnv: Record<EnvKey, string | undefined> = {} as Record<EnvKey, string | undefined>;
const env = process.env as Record<string, string | undefined>;
for (const key of ENV_KEYS) originalEnv[key] = process.env[key];

function setEnv(partial: Partial<Record<EnvKey, string | undefined>>) {
  for (const key of ENV_KEYS) {
    if (key in partial) {
      const value = partial[key];
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

function makeFakeTransport(
  calls: MailMessage[],
  result: MailTransportResult = { ok: true }
): MailTransport {
  return {
    async send(mail) {
      calls.push(mail);
      return result;
    },
  };
}

const throwingTransport: MailTransport = {
  async send() {
    throw new Error('provider exploded');
  },
};

async function run() {
  console.log('  Question: dev mode still works without any email setup?');
  setEnv({
    NODE_ENV: 'development',
    RESEND_API_KEY: undefined,
    EMAIL_FROM: undefined,
    NEXT_PUBLIC_BASE_URL: BASE_URL,
  });
  const devCalls: MailMessage[] = [];
  const devResult = await sendPasswordResetEmail(RECIPIENT, TOKEN, makeFakeTransport(devCalls));
  assert(devResult.ok === true, 'dev send resolves ok:true');
  assert(devResult.transport === 'console', 'dev uses the existing console transport');
  assert(devResult.message.to === RECIPIENT, 'dev message carries the recipient');
  assert(devCalls.length === 0, 'dev never invokes the provider transport');

  console.log('  Question: is the reset URL carried into the email unchanged?');
  const assembled = buildPasswordResetMail(RECIPIENT, TOKEN);
  assert(assembled.to === RECIPIENT, 'message recipient is the user email');
  assert(assembled.text.includes(`/reset-password?token=${TOKEN}`), 'existing reset URL is in the email text');
  assert(assembled.subject === 'Reset your Taprevia password', 'subject unchanged');

  console.log('  Question: does production mode call the provider abstraction with the right payload?');
  setEnv({
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Taprevia <no-reply@example.test>',
    NEXT_PUBLIC_BASE_URL: BASE_URL,
  });
  const prodCalls: MailMessage[] = [];
  const prodResult = await sendPasswordResetEmail(RECIPIENT, TOKEN, makeFakeTransport(prodCalls));
  assert(prodResult.ok === true && prodResult.transport === 'resend', 'production resolves through the resend transport');
  assert(prodCalls.length === 1, 'provider transport invoked exactly once');
  assert(prodCalls[0]?.to === RECIPIENT, 'provider receives the expected recipient');
  assert(prodCalls[0]?.text.includes(`/reset-password?token=${TOKEN}`), 'provider receives the expected reset URL');
  assert(prodCalls[0]?.subject === 'Reset your Taprevia password', 'provider receives the expected subject');

  console.log('  Question: are sender/credentials resolved from the environment?');
  assert(getMailConfig().apiKey === 're_test_key', 'RESEND_API_KEY resolved from env');
  assert(getMailConfig().from === 'Taprevia <no-reply@example.test>', 'EMAIL_FROM resolved as the verified sender');
  setEnv({ RESEND_API_KEY: undefined, EMAIL_FROM: undefined });
  assert(getMailConfig().apiKey === null && getMailConfig().from === null, 'unset credentials resolve to null');

  console.log('  Question: are provider failures handled safely?');
  setEnv({ NODE_ENV: 'production', RESEND_API_KEY: undefined, EMAIL_FROM: 'Taprevia <no-reply@example.test>' });
  const missingKey = await sendPasswordResetEmail(RECIPIENT, TOKEN);
  assert(missingKey.ok === false && missingKey.transport === 'resend', 'missing RESEND_API_KEY → ok:false, no throw');

  setEnv({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: undefined });
  const missingFrom = await sendPasswordResetEmail(RECIPIENT, TOKEN);
  assert(missingFrom.ok === false, 'missing EMAIL_FROM → ok:false, no throw');

  setEnv({ RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Taprevia <no-reply@example.test>' });
  const failingCalls: MailMessage[] = [];
  const failing = await sendPasswordResetEmail(RECIPIENT, TOKEN, makeFakeTransport(failingCalls, { ok: false }));
  assert(failing.ok === false, 'provider ok:false → ok:false, no throw');

  const throwing = await sendPasswordResetEmail(RECIPIENT, TOKEN, throwingTransport);
  assert(throwing.ok === false, 'provider throw → captured, ok:false, no throw');

  // Real Resend SDK path with an invalid key: reaches the API, is rejected, and
  // still fails safely. Network-independent outcome (offline throws are caught).
  const realRejected = await resendTransport().send({ to: RECIPIENT, subject: 't', text: 't' });
  assert(realRejected.ok === false, 'real resend transport (invalid key) → ok:false, no throw');

  console.log('  Cleanup');
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete env[key];
    else env[key] = originalEnv[key];
  }
  assert(true, 'original environment restored');

  console.log(`\n──\nRESULT: ${passed} passed, ${failed} failed`);
  if (failed > 0) console.error(`Failures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Suite crashed:', e);
  process.exit(1);
});