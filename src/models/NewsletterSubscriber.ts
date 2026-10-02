import mongoose, { Schema } from 'mongoose';

const NewsletterSubscriberSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    token: { type: String, default: '' },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

NewsletterSubscriberSchema.index({ cardId: 1, email: 1 }, { unique: true });

export default mongoose.models.NewsletterSubscriber ||
  mongoose.model('NewsletterSubscriber', NewsletterSubscriberSchema);
