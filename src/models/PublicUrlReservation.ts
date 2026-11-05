import mongoose, { Schema } from 'mongoose';

/**
 * Permanent public URL identity registry.
 *
 * A path is inserted before it is written to a Standee. It is never deleted and
 * is never reassigned to a different product identity, even after the original
 * Standee or account is deleted.
 *
 * `instanceId`/`ownerId` are nullable only for historical imports where the
 * original identity is no longer available. A historical reservation is still
 * permanent and blocks reuse.
 *
 * No TTL index: reservations must outlive all customer and product records.
 */

const PublicUrlReservationSchema = new Schema(
  {
    // Canonical lowercase "{business}/{product}" path. The unique index is the
    // final authority for path ownership.
    path: { type: String, required: true, trim: true, lowercase: true, immutable: true },
    kind: {
      type: String,
      enum: ['standee', 'card'],
      required: true,
      immutable: true,
    },
    instanceId: {
      type: Schema.Types.ObjectId,
      default: null,
      immutable: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
    },
    status: {
      type: String,
      enum: ['reserved', 'active', 'retired'],
      default: 'reserved',
    },
    issuedAt: { type: Date, default: Date.now, immutable: true },
    retiredAt: { type: Date, default: null },
    source: {
      type: String,
      enum: ['allocation', 'backfill'],
      required: true,
      immutable: true,
    },
  },
  { timestamps: false, collection: 'public_url_reservations' }
);

PublicUrlReservationSchema.index({ path: 1 }, { unique: true });
PublicUrlReservationSchema.index({ kind: 1, instanceId: 1 });
PublicUrlReservationSchema.index({ ownerId: 1, status: 1 });

export default mongoose.models.PublicUrlReservation ||
  mongoose.model('PublicUrlReservation', PublicUrlReservationSchema);
