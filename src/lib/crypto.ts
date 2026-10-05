import crypto from 'node:crypto';
import { requireJwtSecret } from './env';

/**
 * AES-256-GCM secret encryption helpers.
 *
 * Key resolution:
 *  - APP_KEY (base64 of exactly 32 bytes, e.g. `openssl rand -base64 32`)
 *  - Dev/test fallback ONLY: sha256(JWT_SECRET) when APP_KEY is unset.
 *    In production an unset APP_KEY throws — see resolveKey().
 *
 * Payload format: `v1:<iv.base64>:<authTag.base64>:<ciphertext.base64>`
 * The version prefix allows future algorithm rotations without re-encrypting
 * every stored secret in one migration.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit IV — GCM standard
const KEY_BYTES = 32;

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const appKey = process.env.APP_KEY;
  if (appKey) {
    const key = Buffer.from(appKey, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `APP_KEY must decode to ${KEY_BYTES} bytes. Generate one with: openssl rand -base64 32`
      );
    }
    cachedKey = key;
    return cachedKey;
  }

  // SECURITY: the dev fallback below is a silent, unrecoverable trap in
  // production. A tenant secret encrypted while APP_KEY was unset is sealed
  // with sha256(JWT_SECRET); once APP_KEY is later set (or JWT_SECRET is
  // rotated) the payload becomes undecryptable — and because every caller
  // treats a decrypt failure as a generic "unavailable", the breakage is
  // invisible. Refuse to operate rather than fall back.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_KEY is required in production. Tenant secrets (OpenAI API keys) are ' +
        'AES-256-GCM encrypted with it and cannot be read with a JWT_SECRET-derived ' +
        'key. Generate one with `openssl rand -base64 32`, set it, then re-save each ' +
        "tenant's API key in Settings. Run `npm run check:appkey` to audit existing rows."
    );
  }

  // Dev fallback — deterministic derivation from JWT_SECRET so secrets survive
  // restarts without extra env setup. Never rely on this in production.
  const jwtSecret = requireJwtSecret();
  cachedKey = crypto.createHash('sha256').update(jwtSecret, 'utf8').digest();
  return cachedKey;
}

/** Encrypt a plaintext secret. Returns the versioned payload string. */
export function encryptSecret(plain: string): string {
  if (!plain) throw new Error('encryptSecret: plaintext must be non-empty');
  // Resolve the key OUTSIDE the crypto try/catch so a configuration problem
  // (e.g. APP_KEY unset in production) surfaces with its own actionable
  // message instead of being relabelled as a crypto failure.
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypt a versioned payload. Throws on tamper or unsupported version. */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4) {
    throw new Error('decryptSecret: malformed payload');
  }
  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) {
    throw new Error(`decryptSecret: unsupported payload version "${version}"`);
  }
  // Key resolution stays outside the try: a key-configuration failure is a
  // deployment problem with its own remedy, while everything below is genuine
  // AEAD failure (wrong key for THIS payload, or tampered ciphertext).
  const key = resolveKey();
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('decryptSecret: decryption failed (wrong key or tampered data)');
  }
}

/** Safe display form: shows nothing but the last 4 characters. */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 4) return '••••';
  return `••••${secret.slice(-4)}`;
}

/** Convenience for provisioning docs/scripts: emits a fresh APP_KEY. */
export function generateAppKey(): string {
  return crypto.randomBytes(KEY_BYTES).toString('base64');
}
