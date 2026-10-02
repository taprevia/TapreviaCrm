import mongoose, { Schema } from 'mongoose';

/**
 * ReviewTemplate — a reusable, category-scoped review snippet served in
 * template mode on the public review page. Uses a fixed placeholder set
 * ({businessName}, {employee}, {service}, {keyword}) that is substituted at
 * serve-time with the card's own business personalization — never persisted
 * review text.
 *
 * Edibility rule enforced by the admin/import validation layer: a template
 * whose required variables cannot be satisfied is filtered at selection time,
 * so a placeholder is never rendered unfilled.
 */

export const REVIEW_TEMPLATE_LENGTHS = ['short', 'medium', 'detailed'] as const;
export const REVIEW_TEMPLATE_STYLES = ['friendly', 'professional', 'casual', 'simple'] as const;

const MAX_TEXT_LENGTH = 1000;

const ReviewTemplateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    categoryKey: { type: String, required: true, lowercase: true, trim: true },
    scenario: { type: String, required: true, trim: true },
    language: { type: String, required: true, default: 'English', trim: true },
    text: { type: String, required: true, trim: true },
    variables: { type: [String], default: [] },
    length: { type: String, enum: [...REVIEW_TEMPLATE_LENGTHS], default: 'medium' },
    style: { type: String, enum: [...REVIEW_TEMPLATE_STYLES], default: '' },
    compatibleKeywords: { type: [String], default: [] },
    active: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
    lastShownAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ReviewTemplateSchema.path('text').validate((value: string) => {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}, `Template text must be at most ${MAX_TEXT_LENGTH} characters`);

ReviewTemplateSchema.index({ categoryKey: 1, active: 1, language: 1 });
ReviewTemplateSchema.index({ categoryKey: 1, scenario: 1 });

export default mongoose.models.ReviewTemplate ||
  mongoose.model('ReviewTemplate', ReviewTemplateSchema);