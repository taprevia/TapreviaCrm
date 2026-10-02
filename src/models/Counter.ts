import mongoose, { Schema } from 'mongoose';

/**
 * Monotonic, never-reused sequence numbers.
 *
 * One document per key; the sequence only ever moves forward, so Customer IDs
 * and per-base business-slug suffixes can never be re-issued after a record is
 * removed. See src/lib/services/customer-identity.ts.
 */

const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, collection: 'counters' }
);

export default mongoose.models.Counter || mongoose.model('Counter', CounterSchema);