import mongoose, { Schema } from 'mongoose';

/**
 * Safe default for public AI review-generation per tenant, per UTC day.
 * `0` means "unlimited" (explicit opt-out in Settings → AI Assistant).
 */
export const DEFAULT_AI_GENERATION_DAILY_LIMIT = 50;

const TenantSettingsSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    general: {
      currency: { type: String, default: 'INR' },
      timeFormat12h: { type: Boolean, default: true },
      newsletterModalDelaySeconds: { type: Number, default: 8 },
      inquiryAttachmentsEnabled: { type: Boolean, default: false },
      askDetailsBeforeDownload: { type: Boolean, default: false },
      enablePWA: { type: Boolean, default: false },
    },
    openai: {
      enabled: { type: Boolean, default: false },
      apiKeyEnc: { type: String, default: '' }, // AES-256-GCM payload via src/lib/crypto.ts
      model: { type: String, default: 'gpt-4o-mini' },
      // Daily budget for public AI review-generation. `0` = unlimited.
      dailyLimit: { type: Number, default: DEFAULT_AI_GENERATION_DAILY_LIMIT },
      // Atomic consumption ledger keyed by UTC date `YYYY-MM-DD` → count of
      // reservations made that day (see review-generate service).
      usage: { type: Map, of: Number, default: () => ({}) },
    },
    paymentGateways: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.models.TenantSettings ||
  mongoose.model('TenantSettings', TenantSettingsSchema);
