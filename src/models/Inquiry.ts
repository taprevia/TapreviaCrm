import mongoose, { Schema } from 'mongoose';

const InquiryNoteSchema = new Schema(
  {
    text: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const InquirySchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    message: { type: String, default: '' },
    attachmentUrl: { type: String, default: '' },
    source: {
      type: String,
      enum: ['contact_form', 'exchange_modal', 'vcf_gate'],
      default: 'contact_form',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'won', 'lost'],
      default: 'new',
    },
    notes: { type: [InquiryNoteSchema], default: [] },
  },
  { timestamps: true }
);

InquirySchema.index({ userId: 1, createdAt: -1 });
InquirySchema.index({ cardId: 1 });

export default mongoose.models.Inquiry ||
  mongoose.model('Inquiry', InquirySchema);
