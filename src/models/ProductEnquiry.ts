import mongoose, { Schema } from 'mongoose';

const ProductEnquirySchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productTitle: { type: String, default: '' },
    name: { type: String, default: '', trim: true },
    note: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    channel: {
      type: String,
      enum: ['whatsapp'],
      default: 'whatsapp',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'won', 'lost'],
      default: 'new',
    },
  },
  { timestamps: true }
);

ProductEnquirySchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.ProductEnquiry ||
  mongoose.model('ProductEnquiry', ProductEnquirySchema);
