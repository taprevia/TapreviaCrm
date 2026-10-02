import mongoose, { Schema } from 'mongoose';

// Assignment-level configuration for products whose physical instance (Card /
// Standee) has not been bound yet. Card-shaped so it can be applied verbatim to
// the Card when the instance is later linked, then cleared — there is exactly
// ONE authoritative configuration source at any point in time: the instance
// while bound, or this pending record while uninstantiated.
const PendingConfigSchema = new Schema(
  {
    kind: { type: String, default: '' },
    redirectUrl: { type: String, default: '' },
    instagramConfig: {
      username: { type: String, default: '' },
      profileUrl: { type: String, default: '' },
      reelsUrl: { type: String, default: '' },
      postsUrl: { type: String, default: '' },
      dmUrl: { type: String, default: '' },
      shopUrl: { type: String, default: '' },
    },
    whatsappConfig: {
      phoneNumber: { type: String, default: '' },
      defaultMessage: { type: String, default: '' },
    },
    linkedinConfig: {
      profileUrl: { type: String, default: '' },
      resumeUrl: { type: String, default: '' },
    },
    facebookConfig: {
      profileUrl: { type: String, default: '' },
      pageUrl: { type: String, default: '' },
      messengerUrl: { type: String, default: '' },
    },
    reviewAssistant: {
      enabled: { type: Boolean, default: true },
      googleReviewUrl: { type: String, default: '' },
    },
    displayName: { type: String, default: '' },
    cardLabel: { type: String, default: '' },
  },
  { _id: false }
);

const UserProductSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    catalogProductId: { type: Schema.Types.ObjectId, ref: 'CatalogProduct', required: true },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    standeeId: { type: Schema.Types.ObjectId, ref: 'Standee', default: null },
    // Present only while the assignment has no physical instance yet.
    pendingConfig: { type: PendingConfigSchema, default: null },
    quantity: { type: Number, default: 1, min: 1, max: 99 },
    unitPriceMinor: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'removed'],
      default: 'active',
    },
    notes: { type: String, default: '' },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Physical material for NFC cards (pvc, metal, wooden)
    material: {
      type: String,
      enum: ['pvc', 'metal', 'wooden'],
      default: 'pvc',
    },
  },
  { timestamps: true }
);

UserProductSchema.index({ userId: 1, status: 1 });
UserProductSchema.index({ catalogProductId: 1 });
UserProductSchema.index({ cardId: 1 });

export default mongoose.models.UserProduct ||
  mongoose.model('UserProduct', UserProductSchema);
