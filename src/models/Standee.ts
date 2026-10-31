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

const STANDEE_REVIEW_STYLES = ['friendly', 'professional', 'casual', 'simple'] as const;
const STANDEE_REVIEW_LENGTHS = ['short', 'medium', 'detailed'] as const;
const STANDEE_REVIEW_MODES = ['fixed', 'varied'] as const;

/**
 * Optional product-level overrides for the Google Review Standee review host.
 * Mirrors the Card override contract; every field is optional and missing means
 * "inherit the selected settings source".
 */
const StandeeReviewOverrideSchema = new Schema(
  {
    enabled: { type: Boolean },
    googleReviewUrl: { type: String, trim: true },
    writingStyle: { type: String, enum: [...STANDEE_REVIEW_STYLES] },
    preferredLength: { type: String, enum: [...STANDEE_REVIEW_LENGTHS] },
    styleMode: { type: String, enum: [...STANDEE_REVIEW_MODES] },
    lengthMode: { type: String, enum: [...STANDEE_REVIEW_MODES] },
    languages: { type: [String], default: undefined },
    feedbackTopics: { type: [String], default: undefined },
    welcomeMessage: { type: String },
    category: { type: String, trim: true },
    employees: { type: [String], default: undefined },
    services: { type: [String], default: undefined },
    keywords: { type: [String], default: undefined },
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
    // Route identifier. No `default: ''` — an absent value must stay undefined
    // so the unique+sparse index skips it instead of colliding on duplicate
    // empty strings (E11000).
    routeSlug: { type: String },
    // Timestamp-based unique identifier for NEW standee links (mirrors
    // routeSlug for freshly created standees). Additive + sparse: legacy
    // standees have no `uid` and continue to resolve by routeSlug. Never used
    // to overwrite an existing routeSlug.
    uid: { type: String, trim: true },
    // Human-readable public URL path ("{business-slug}/standee[-N]"). Permanent
    // identity for printed material — allocated once, never regenerated. No
    // `default: ''`: absent stays undefined so the unique+sparse index skips it.
    publicSlug: { type: String },
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
    // Phase 4D.6 additive review-host configuration. Absent source means the
    // explicit initial strategy: Central Settings when saved, otherwise
    // Standee product settings. The Standee's own Google destination is always
    // preserved unless a hybrid override explicitly replaces it.
    reviewSettingsSource: {
      type: String,
      enum: ['legacy', 'central', 'hybrid'],
    },
    reviewSettingsVersion: { type: Number, default: 0, min: 0 },
    reviewOverrides: { type: StandeeReviewOverrideSchema, default: undefined },
    reviewSettingsUpdatedAt: { type: Date, default: null },
    reviewSettingsUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

StandeeSchema.index({ userId: 1 });
StandeeSchema.index({ 'panelQr.qrId': 1 }, { unique: true });
StandeeSchema.index({ 'socialQrs.qrId': 1 }, { unique: true, sparse: true });
StandeeSchema.index({ routeSlug: 1 }, { unique: true, sparse: true });
StandeeSchema.index({ uid: 1 }, { unique: true, sparse: true });
StandeeSchema.index({ publicSlug: 1 }, { unique: true, sparse: true });

export default mongoose.models.Standee || mongoose.model('Standee', StandeeSchema);
