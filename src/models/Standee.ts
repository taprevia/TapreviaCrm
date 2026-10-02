import mongoose, { Schema } from 'mongoose';

const StandeeSocialQrSchema = new Schema(
  {
    qrId: { type: String, required: true },
    platform: { type: String, required: true },
    qrColor: { type: String, default: '#000000' },
    label: { type: String, default: '' },
    // Dynamic destination for this slot. May be empty until configured. When
    // set, it takes precedence over the shared Profile.socialLinks fallback,
    // so each slot of each standee is independently configurable and survives
    // physical asset replacement.
    destinationUrl: { type: String, default: '' },
  },
  { _id: false }
);

/**
 * Optional physical zone (3–4 per multi-profile standee). Each zone maps to
 * one card's public page. Inert for now — routing lands in a later phase.
 */
const StandeeZoneSchema = new Schema(
  {
    zoneId: { type: String, required: true },
    label: { type: String, default: '' },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    qrColor: { type: String, default: '#000000' },
  },
  { _id: false }
);

const StandeeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: 'Counter Standee', trim: true },
    // Public display name shown on the panel/QR picker page and as the brand
    // fallback when the owner has no Profile document.
    displayName: { type: String, default: '', trim: true },
    routeSlug: { type: String, default: '' },
    // Human-readable public URL path ("{business-slug}/standee[-N]"). Permanent
    // identity for printed material — allocated once, never regenerated.
    publicSlug: { type: String, default: '' },
    // Product-level configuration: how many fixed slots this physical standee
    // has and which platform profile type each slot maps to (in 1-indexed order).
    // The customer may change each slot's *destination* but not the slot types.
    productKey: { type: String, default: '' },
    maxProfiles: { type: Number, default: 0 },
    fixedProfiles: { type: [String], default: [] },
    panelQr: {
      qrId: { type: String, required: true },
      qrColor: { type: String, default: '#000000' },
    },
    socialQrs: { type: [StandeeSocialQrSchema], default: [] },
    zones: { type: [StandeeZoneSchema], default: [] },
  },
  { timestamps: true }
);

StandeeSchema.index({ userId: 1 });
StandeeSchema.index({ 'panelQr.qrId': 1 }, { unique: true });
StandeeSchema.index({ 'socialQrs.qrId': 1 }, { unique: true, sparse: true });
StandeeSchema.index({ routeSlug: 1 }, { unique: true, sparse: true });
StandeeSchema.index({ publicSlug: 1 }, { unique: true, sparse: true });

export default mongoose.models.Standee || mongoose.model('Standee', StandeeSchema);
