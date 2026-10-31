import mongoose, { Schema } from 'mongoose';

/**
 * ReviewRotationState — additive per-business/category cycle state.
 *
 * The event collection remains the immutable copy audit; this document is the
 * current cursor (cycle + templates already copied in that cycle). Historical
 * cycles are never deleted. Production index creation must use the approved
 * maintenance procedure (startup autoIndex is disabled in production).
 */
const ReviewRotationStateSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    categoryKey: { type: String, required: true, lowercase: true, trim: true },
    cycle: { type: Number, default: 0, min: 0 },
    usedTemplateIds: { type: [Schema.Types.ObjectId], default: [] },
    lastResetBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastResetReason: { type: String, default: '' },
    lastResetAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ReviewRotationStateSchema.index(
  { businessId: 1, categoryKey: 1 },
  { unique: true }
);

export default mongoose.models.ReviewRotationState ||
  mongoose.model('ReviewRotationState', ReviewRotationStateSchema);
