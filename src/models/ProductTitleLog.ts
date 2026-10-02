import mongoose, { Schema } from 'mongoose';

// Rename audit trail for product titles (a customer or admin changing what a
// product is called inside the CRM). Mirrors the AdminAuditLog retention
// policy: rows are kept for a year, then auto-purged.
const ProductTitleLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userProductId: { type: Schema.Types.ObjectId, ref: 'UserProduct', required: true },
    instanceType: {
      type: String,
      enum: ['card', 'standee'],
      default: 'card',
    },
    instanceId: { type: Schema.Types.ObjectId, default: null },
    previousTitle: { type: String, default: '' },
    newTitle: { type: String, required: true },
    source: {
      type: String,
      enum: ['customer', 'admin'],
      default: 'customer',
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ProductTitleLogSchema.index({ userId: 1, createdAt: -1 });
ProductTitleLogSchema.index({ userProductId: 1, createdAt: -1 });
ProductTitleLogSchema.index({ createdAt: -1 });
// Compliance-relevant window without unbounded collection growth.
ProductTitleLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export default mongoose.models.ProductTitleLog ||
  mongoose.model('ProductTitleLog', ProductTitleLogSchema);