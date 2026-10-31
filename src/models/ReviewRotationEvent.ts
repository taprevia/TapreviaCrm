import mongoose, { Schema } from 'mongoose';

/**
 * ReviewRotationEvent — additive audit of AI review template copies.
 *
 * This collection is the foundation for business-scoped smart rotation. Phase
 * 4A records copy history only; suggestion filtering is intentionally
 * unchanged. A row means the customer copied the template text, not that a
 * Google review was published.
 *
 * Uniqueness:
 *  - one copy per business/category/template/cycle
 *  - one row per client idempotency key (`copyId`)
 * Both indexes must be created through the approved production index
 * procedure; application startup does not create them in production.
 */
const ReviewRotationEventSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryKey: { type: String, required: true, lowercase: true, trim: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'ReviewTemplate', required: true },
    cycle: { type: Number, default: 0, min: 0 },
    copyId: { type: String, required: true, trim: true, maxlength: 100 },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    // Additive Phase 4D.6 host metadata. Existing Card events keep cardId and
    // leave this unset; historical records are never rewritten.
    standeeId: { type: Schema.Types.ObjectId, ref: 'Standee' },
    copiedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ReviewRotationEventSchema.index(
  { businessId: 1, categoryKey: 1, templateId: 1, cycle: 1 },
  { unique: true }
);
ReviewRotationEventSchema.index({ copyId: 1 }, { unique: true });
ReviewRotationEventSchema.index({ businessId: 1, categoryKey: 1, copiedAt: -1 });
ReviewRotationEventSchema.index({ businessId: 1, copiedAt: -1 });

export default mongoose.models.ReviewRotationEvent ||
  mongoose.model('ReviewRotationEvent', ReviewRotationEventSchema);
