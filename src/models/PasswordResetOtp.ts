import mongoose, { Schema } from 'mongoose';

/**
 * Password-reset OTP challenge + short-lived reset grant.
 *
 * - The six-digit OTP is never stored. Only an HMAC digest bound to this
 *   challenge id and the normalized email is persisted.
 * - A successful verification issues an opaque grant; only its SHA-256 hash is
 *   stored. The grant is single-use and scoped to this challenge/user.
 * - `purgeAt` is a TTL field. It outlives both the OTP and the grant so an
 *   expired row can never take a valid grant with it.
 *
 * This is additive and does not touch legacy PasswordResetToken records.
 */
const PasswordResetOtpSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0, min: 0 },
    sentAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    grantHash: { type: String, default: undefined },
    grantExpiresAt: { type: Date, default: null },
    grantClaimedAt: { type: Date, default: null },
    grantUsedAt: { type: Date, default: null },
    purgeAt: { type: Date, required: true },
  },
  { timestamps: true }
);

PasswordResetOtpSchema.index({ email: 1, createdAt: -1 });
PasswordResetOtpSchema.index({ email: 1, supersededAt: 1, verifiedAt: 1 });
PasswordResetOtpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });
PasswordResetOtpSchema.index({ grantHash: 1 }, { unique: true, sparse: true });

export default mongoose.models.PasswordResetOtp ||
  mongoose.model('PasswordResetOtp', PasswordResetOtpSchema);
