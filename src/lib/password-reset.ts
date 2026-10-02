/**
 * Forgot-password token lifecycle.
 *
 * Tokens are high-entropy 32-byte hex strings. Only a sha256 digest is ever
 * persisted; the raw secret is delivered to the user's email. Consume is
 * atomic and one-time (usedAt set on match) and time-boxed (expiresAt, backed
 * by a TTL index). Plain new passwords are re-hashed by the existing User
 * pre-save hook, so this module never touches bcrypt directly.
 */

import { createHash, randomBytes } from 'crypto';
import PasswordResetToken from '@/models/PasswordResetToken';
import User from '@/models/User';
import { connectDB } from '@/lib/db';

export const RESET_EXPIRY_MS = 30 * 60_000;

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export async function mintResetToken(userId: string): Promise<{
  token: string;
  tokenHash: string;
  expiresAt: Date;
}> {
  await connectDB();

  // One active token per user: issuing a new reset invalidates older ones.
  await PasswordResetToken.deleteMany({ userId, usedAt: null });

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS);
  await PasswordResetToken.create({ userId, tokenHash, expiresAt });
  return { token, tokenHash, expiresAt };
}

export async function consumeResetToken(
  token: string,
  newPassword: string
): Promise<{ ok: true } | { ok: false }> {
  await connectDB();

  const tokenHash = hashResetToken(token);
  const consumed = await PasswordResetToken.findOneAndUpdate(
    { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: false }
  );
  if (!consumed) return { ok: false };

  const user = await User.findById(consumed.userId);
  if (!user) return { ok: false };

  user.passwordHash = newPassword;
  await user.save();
  return { ok: true };
}