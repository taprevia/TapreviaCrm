import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import mongoose from 'mongoose';
import PasswordResetOtp from '@/models/PasswordResetOtp';
import User from '@/models/User';
import { connectDB } from '@/lib/db';
import { requireJwtSecret } from '@/lib/env';

export const OTP_TTL_MS = 10 * 60_000;
export const GRANT_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_SEND_LIMIT = 4;
export const OTP_SEND_WINDOW_MS = 15 * 60_000;
export const OTP_IP_LIMIT = 20;
export const OTP_IP_WINDOW_MS = 15 * 60_000;

const PURGE_AFTER_MS = 24 * 60 * 60_000;
const GRANT_CLAIM_STALE_MS = 2 * 60_000;

export type OtpRequestResult =
  | { ok: true; challengeId: string; otp: string; expiresAt: Date }
  | { ok: false };

export type OtpVerifyResult =
  | { ok: true; grant: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'locked' };

export type ResetCompleteResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'used' | 'user_missing' };

export function normalizeResetEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Uniform 000000–999999 using the platform CSPRNG. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function generateGrant(): string {
  return randomBytes(32).toString('hex');
}

export function hashGrant(grant: string): string {
  return createHash('sha256').update(grant, 'utf8').digest('hex');
}

function otpDigest(challengeId: string, email: string, otp: string): string {
  // HMAC with a purpose-separated server secret. A plain hash of a 6-digit
  // value would be trivially reversible offline.
  return createHmac('sha256', requireJwtSecret())
    .update(`password-reset-otp:v1|${challengeId}|${email}|${otp}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, 'hex');
    const right = Buffer.from(b, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

/** Latest OTP issuance for cooldown/timing checks. */
export async function latestOtpSentAt(email: string): Promise<Date | null> {
  await connectDB();
  const doc = await PasswordResetOtp.findOne({
    email: normalizeResetEmail(email),
    sentAt: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .select('sentAt')
    .lean<{ sentAt?: Date | null } | null>();
  return doc?.sentAt ?? null;
}

/**
 * Create a pending challenge. It is not active until `confirmOtpSent` runs, so
 * a provider failure can never invalidate the previously usable OTP.
 */
export async function beginOtpChallenge(
  userId: string,
  email: string
): Promise<OtpRequestResult> {
  await connectDB();
  const normalized = normalizeResetEmail(email);
  const challengeId = new mongoose.Types.ObjectId();
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const purgeAt = new Date(expiresAt.getTime() + PURGE_AFTER_MS);

  await PasswordResetOtp.create({
    _id: challengeId,
    userId,
    email: normalized,
    otpHash: otpDigest(challengeId.toHexString(), normalized, otp),
    expiresAt,
    purgeAt,
  });

  return { ok: true, challengeId: challengeId.toHexString(), otp, expiresAt };
}

/** Activate a successfully delivered OTP and supersede older active ones. */
export async function confirmOtpSent(challengeId: string, email: string): Promise<void> {
  const id = new mongoose.Types.ObjectId(challengeId);
  const now = new Date();
  await PasswordResetOtp.updateOne({ _id: id }, { $set: { sentAt: now } });
  await PasswordResetOtp.updateMany(
    {
      email: normalizeResetEmail(email),
      _id: { $ne: id },
      sentAt: { $ne: null },
      supersededAt: null,
      grantUsedAt: null,
    },
    { $set: { supersededAt: now } }
  );
}

/** Remove a pending challenge when the provider did not accept the message. */
export async function discardOtpChallenge(challengeId: string): Promise<void> {
  await PasswordResetOtp.deleteOne({
    _id: new mongoose.Types.ObjectId(challengeId),
    sentAt: null,
  });
}

export async function verifyOtp(email: string, otp: string): Promise<OtpVerifyResult> {
  await connectDB();
  const normalized = normalizeResetEmail(email);
  const challenge = await PasswordResetOtp.findOne({
    email: normalized,
    sentAt: { $ne: null },
    supersededAt: null,
    verifiedAt: null,
    grantUsedAt: null,
  }).sort({ createdAt: -1 });

  if (!challenge) return { ok: false, reason: 'invalid' };
  if (challenge.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'invalid' };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const expected = otpDigest(challenge._id.toString(), normalized, otp);
  if (!safeEqualHex(expected, challenge.otpHash)) {
    await PasswordResetOtp.updateOne(
      { _id: challenge._id, attempts: { $lt: OTP_MAX_ATTEMPTS } },
      { $inc: { attempts: 1 } }
    );
    return { ok: false, reason: 'invalid' };
  }

  const grant = generateGrant();
  const grantExpiresAt = new Date(Date.now() + GRANT_TTL_MS);
  const verified = await PasswordResetOtp.findOneAndUpdate(
    {
      _id: challenge._id,
      verifiedAt: null,
      supersededAt: null,
      grantUsedAt: null,
      attempts: { $lt: OTP_MAX_ATTEMPTS },
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        verifiedAt: new Date(),
        grantHash: hashGrant(grant),
        grantExpiresAt,
      },
    },
    { new: true }
  );
  if (!verified) return { ok: false, reason: 'invalid' };
  return { ok: true, grant, expiresAt: grantExpiresAt };
}

export async function completePasswordReset(
  grant: string,
  newPassword: string
): Promise<ResetCompleteResult> {
  await connectDB();
  const grantHash = hashGrant(grant);
  const now = new Date();
  const staleClaim = new Date(Date.now() - GRANT_CLAIM_STALE_MS);

  const claimed = await PasswordResetOtp.findOneAndUpdate(
    {
      grantHash,
      verifiedAt: { $ne: null },
      grantUsedAt: null,
      grantExpiresAt: { $gt: now },
      $or: [{ grantClaimedAt: null }, { grantClaimedAt: { $lt: staleClaim } }],
    },
    { $set: { grantClaimedAt: now } },
    { new: false }
  );

  if (!claimed) {
    const used = await PasswordResetOtp.exists({
      grantHash,
      verifiedAt: { $ne: null },
      grantUsedAt: { $ne: null },
    });
    return { ok: false, reason: used ? 'used' : 'invalid' };
  }

  try {
    const user = await User.findById(claimed.userId);
    if (!user) {
      await PasswordResetOtp.updateOne(
        { _id: claimed._id },
        { $set: { grantClaimedAt: null } }
      );
      return { ok: false, reason: 'user_missing' };
    }

    user.passwordHash = newPassword;
    await user.save();

    await PasswordResetOtp.updateOne(
      { _id: claimed._id },
      { $set: { grantUsedAt: new Date(), grantClaimedAt: null } }
    );
    return { ok: true };
  } catch (error) {
    // Do not permanently burn the grant when the password write failed.
    await PasswordResetOtp.updateOne(
      { _id: claimed._id },
      { $set: { grantClaimedAt: null } }
    ).catch(() => undefined);
    throw error;
  }
}
