import mongoose, { Schema } from 'mongoose';

const ProductSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    priceMinor: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    imageUrl: { type: String, default: '' },
    category: { type: String, default: '' },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    enquiryCount: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

ProductSchema.index({ cardId: 1, sortOrder: 1 });
ProductSchema.index({ userId: 1 });

export default mongoose.models.Product ||
  mongoose.model('Product', ProductSchema);
