import mongoose, { Schema } from 'mongoose';

const LeadSchema = new Schema(
  {
    cardOwnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    company: { type: String, trim: true, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

LeadSchema.index({ cardOwnerId: 1, createdAt: -1 });

export default mongoose.models.Lead || mongoose.model('Lead', LeadSchema);
