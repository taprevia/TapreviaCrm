import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { assignCustomerId } from '@/lib/services/customer-identity';

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Permanent human-readable customer identifier (CUST-000001 style).
    // Additive field, sparse-unique: unset until first save, assigned once,
    // never re-used — identity label only, never a routing key.
    customerId: {
      type: String,
      trim: true,
    },
    // Account-level business slug for the human-readable public URL
    // ("/{business-slug}/{product-slug}"). Additive field, sparse-unique:
    // unset until derived on first card allocation.
    bizSlug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: '', trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    hasStandy: { type: Boolean, default: false },
    planId: { type: String, default: 'free' },
    // Customer master switch for the public newsletter popup. Default OFF —
    // the popup only runs its delay timer when this is true.
    isNewsletterEnabled: { type: Boolean, default: false },
  },
  { timestamps: true }
);

UserSchema.index({ bizSlug: 1 }, { unique: true, sparse: true });
UserSchema.index({ customerId: 1 }, { unique: true, sparse: true });

UserSchema.pre('save', async function () {
  if (this.customerId) return;
  this.customerId = await assignCustomerId(this);
});

UserSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  if (/^\$2[aby]\$/.test(this.passwordHash)) return;
  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
});

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export default mongoose.models.User || mongoose.model('User', UserSchema);
