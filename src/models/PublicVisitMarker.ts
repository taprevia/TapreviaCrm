import mongoose, { Schema } from 'mongoose';

/**
 * One-time, short-lived marker that attributes a Business Profile Standee QR
 * scan to its Standee while the linked profile Card renders.
 *
 * The `token` is an opaque random nonce (never a signed payload and never
 * client-controlled): unguessable, bound to the exact `cardId`, consumed
 * atomically by `consumeStandeeVisitMarker` (single-use), and auto-purged by
 * the TTL index on `expiresAt`. This lets the final profile page record a
 * single Standee-attributed visit for a scan that would otherwise be counted
 * twice (once for the Standee redirect, once for the Card render).
 */

const PublicVisitMarkerSchema = new Schema(
  {
    token: { type: String, required: true },
    standeeId: { type: Schema.Types.ObjectId, ref: 'Standee', required: true },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

PublicVisitMarkerSchema.index({ token: 1 }, { unique: true });
PublicVisitMarkerSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.PublicVisitMarker ||
  mongoose.model('PublicVisitMarker', PublicVisitMarkerSchema);
