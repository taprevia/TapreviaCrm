import mongoose, { Schema } from 'mongoose';

const AnalyticsLogSchema = new Schema(
  {
    cardId: { type: Schema.Types.ObjectId, ref: 'Card', default: null },
    // Additive Phase 4D.6 attribution for Standee review events. Existing Card
    // analytics rows keep cardId and leave this unset.
    standeeId: { type: Schema.Types.ObjectId, ref: 'Standee' },
    action: {
      type: String,
      enum: [
        'public_visit',
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
    // Retain field compatibility, but do not persist visitor identifiers in
    // new analytics records. Existing rows are neither read nor rewritten.
    ip: { type: String, default: '', set: () => '' },
    userAgent: { type: String, default: '', set: () => '' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AnalyticsLogSchema.index({ cardId: 1, timestamp: -1 });
AnalyticsLogSchema.index({ standeeId: 1, timestamp: -1 });
// Phase 4D.7 unified review analytics (created via the approved production
// index procedure; no startup index creation in production).
AnalyticsLogSchema.index({ cardId: 1, action: 1, createdAt: -1 });
AnalyticsLogSchema.index({ standeeId: 1, action: 1, createdAt: -1 });
// Fastest-growing collection (every tap/track writes a row). Retention guard
// keeps the shared M0 tier (512MB) predictable on serverless hosting — 180
// days of rows, auto-purged by Mongo's TTL sweeper.
AnalyticsLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

export default mongoose.models.AnalyticsLog ||
  mongoose.model('AnalyticsLog', AnalyticsLogSchema);
