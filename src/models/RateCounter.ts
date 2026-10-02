import mongoose, { Schema } from 'mongoose';

/**
 * Shared-serverless rate-limit counters. Each limit window is one document;
 * a TTL index purges windows once they've passed so the collection stays
 * bounded without a cleanup job. See src/lib/rate-limit.ts.
 */

const RateCounterSchema = new Schema(
  {
    /** Compacted (hashed) user/IP/action key. */
    key: { type: String, required: true },
    /** Fixed-window start epoch ms. */
    window: { type: Number, required: true },
    hits: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false, collection: 'ratecounters' }
);

// One counter per (key, window); upserts rely on this to stay atomic.
RateCounterSchema.index({ key: 1, window: 1 }, { unique: true });
RateCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.RateCounter ||
  mongoose.model('RateCounter', RateCounterSchema);