import mongoose, { Schema } from 'mongoose';

/**
 * One-time password reset tokens for the forgot-password flow.
 *
 * Only a sha256 digest of the token is persisted — the raw 32-byte hex secret
 * lives solely in the reset email and is never stored. A TTL index purges
 * expired rows without a cleanup job, mirroring the `ratecounters` pattern.
 */

const PasswordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PasswordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
PasswordResetTokenSchema.index({ userId: 1, usedAt: 1 });

export default mongoose.models.PasswordResetToken ||
  mongoose.model('PasswordResetToken', PasswordResetTokenSchema);