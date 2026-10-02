import mongoose, { Schema } from 'mongoose';

const AnalyticsLogSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    action: {
      type: String,
      enum: [
        'tap',
        'vcard_download',
        'link_click',
        'form_submit',
        'exchange',
        'product_enquiry',
        'share',
        'social_redirect',
        'review_page_view',
        'review_started',
        'review_generated',
        'review_copied',
        'review_google_clicked',
        'review_suggestions_shown',
        'review_template_used',
      ],
      required: true,
    },
    metadata: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AnalyticsLogSchema.index({ cardId: 1, timestamp: -1 });
// Fastest-growing collection (every tap/track writes a row). Retention guard
// keeps the shared M0 tier (512MB) predictable on serverless hosting — 180
// days of rows, auto-purged by Mongo's TTL sweeper.
AnalyticsLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export default mongoose.models.AnalyticsLog ||
  mongoose.model('AnalyticsLog', AnalyticsLogSchema);
