/**
 * APP_KEY consistency audit for tenant secrets (OpenAI API keys).
 *
 * Tenant secrets are sealed with AES-256-GCM (`src/lib/crypto.ts`). The key is
 * derived from `APP_KEY`, or — in development only — from sha256(JWT_SECRET).
 * That fallback makes a dev→prod promotion silently destructive: payloads
 * encrypted locally with a JWT_SECRET-derived key become undecryptable the
 * moment production sets a real APP_KEY (or rotates JWT_SECRET), and every
 * caller collapses the failure into one generic "service unavailable" message.
 *
 * This script answers the only question that matters before/after any APP_KEY
 * or JWT_SECRET change: **can the currently loaded key still read every stored
 * secret?**
 *
 * Strictly read-only. It never writes, re-encrypts, or prints a plaintext key
 * or ciphertext — only counts, tenant ids and failure reasons.
 *
 * Exit code 0 = every stored secret decrypts. 1 = at least one does not.
 *
 * Run with: npm run check:appkey
 */

import { connectDB } from '@/lib/db';
import TenantSettings from '@/models/TenantSettings';
import { decryptSecret } from '@/lib/crypto';

interface EncryptedRow {
  _id: unknown;
  userId: unknown;
  openai?: { enabled?: boolean; apiKeyEnc?: string };
}

function report(label: string, value: string | number): void {
  console.log(`${label.padEnd(52)} ${value}`);
}

/**
 * Classify a decrypt failure so the operator knows which knob to turn. The
 * underlying reason is intentionally coarse — GCM auth failures are opaque by
 * design and carry no information about the plaintext.
 */
function classify(payload: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/malformed payload/i.test(message)) return 'malformed payload (corrupt or truncated)';
  if (/unsupported payload version/i.test(message)) return 'unsupported payload version';
  if (/APP_KEY is required in production/i.test(message)) {
    return 'APP_KEY is not set in this environment';
  }
  if (/wrong key or tampered data/i.test(message)) {
    return payload.startsWith('v1:') ? 'auth failure — key does not match' : 'auth failure';
  }
  return message;
}

async function main(): Promise<void> {
  await connectDB();

  const appKeySet = Boolean(process.env.APP_KEY);
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  console.log('═ APP_KEY consistency audit — tenant secrets ═\n');

  // ─── Environment ──────────────────────────────────────────────────────
  report('NODE_ENV', nodeEnv);
  report('APP_KEY present', appKeySet ? 'yes' : 'NO');
  report('Effective key source', appKeySet ? 'APP_KEY' : 'sha256(JWT_SECRET) fallback');

  if (!appKeySet) {
    console.log(
      '\n⚠ APP_KEY is unset. In production src/lib/crypto.ts now throws instead of\n' +
        '  falling back, so this environment cannot read production secrets at all.\n' +
        '  Set APP_KEY (openssl rand -base64 32) to the value that sealed the data.'
    );
  }

  // ─── Inventory ────────────────────────────────────────────────────────
  const rows = (await TenantSettings.find({
    'openai.apiKeyEnc': { $exists: true, $nin: ['', null] },
  })
    .select('userId openai.enabled openai.apiKeyEnc')
    .lean()) as unknown as EncryptedRow[];

  const total = rows.length;
  const enabledCount = rows.filter((r) => r.openai?.enabled === true).length;

  console.log('\n— Inventory —');
  report('Tenant settings rows', total);
  report('  with AI assistant enabled', enabledCount);
  report('  with AI assistant disabled', total - enabledCount);

  if (total === 0) {
    console.log('\n✓ NO STORED SECRETS — nothing to verify.');
    process.exit(0);
  }

  // ─── Decrypt audit ────────────────────────────────────────────────────
  const failures: Array<{ tenant: string; reason: string }> = [];
  let decrypted = 0;
  let emptyPlaintext = 0;

  for (const row of rows) {
    const payload = String(row.openai?.apiKeyEnc ?? '');
    const tenant = String(row.userId ?? row._id);
    if (!payload) continue;
    try {
      const plain = decryptSecret(payload);
      if (!plain) emptyPlaintext += 1;
      decrypted += 1;
    } catch (error) {
      failures.push({ tenant, reason: classify(payload, error) });
    }
  }

  console.log('\n— Decryption —');
  report('Secrets decrypted successfully', decrypted);
  report('Secrets that FAILED to decrypt', failures.length);
  if (emptyPlaintext > 0) report('  decrypted to an empty string', emptyPlaintext);

  if (failures.length > 0) {
    console.log('\n✗ UNDECRYPTABLE SECRETS');
    for (const f of failures) {
      console.log(`   tenant ${f.tenant}: ${f.reason}`);
    }
    const reasons = new Set(failures.map((f) => f.reason));
    console.log('\n  Likely causes, in order of probability:');
    if (reasons.has('APP_KEY is not set in this environment')) {
      console.log('    • APP_KEY is missing from this environment. Generate one with');
      console.log('      `openssl rand -base64 32`, set it in the Vercel project, redeploy,');
      console.log('      then re-run this script.');
    }
    if (reasons.has('auth failure — key does not match')) {
      console.log('    • APP_KEY differs from the value that encrypted these rows');
      console.log('      (common after a dev→prod promotion, or after a rotation)');
      console.log('    • JWT_SECRET rotated while APP_KEY was unset (fallback key changed)');
    }
    if (reasons.has('malformed payload (corrupt or truncated)')) {
      console.log('    • A stored payload was truncated or overwritten — re-save that key');
    }
    console.log(
      '\n  Recovery: set the correct APP_KEY, then re-save each affected tenant API key\n' +
        '  in Dashboard → Settings → AI Assistant. Encryption is one-way, so there is\n' +
        '  no migration path other than re-entering the key.'
    );
  }

  console.log(
    '\n' +
      (failures.length === 0
        ? '✓ ALL STORED SECRETS ARE READABLE BY THE CURRENT KEY'
        : '✗ KEY DIVERGENCE DETECTED — AI review generation will fail for the tenants listed')
  );

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('APP_KEY consistency audit failed:', error);
  process.exit(1);
});