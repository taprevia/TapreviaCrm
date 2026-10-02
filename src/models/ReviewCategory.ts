import mongoose, { Schema } from 'mongoose';

/**
 * ReviewCategory — a reusable business category (e.g. "mobile-repair") that
 * drives the public review page's template-based suggestions mode.
 *
 * Scenarios are embedded on the category (mirroring how the repo embeds
 * `socialQrs`/`zones`/`components`) so the library stays a single catalog
 * document plus its template documents — no third collection.
 */

const MAX_SCENARIOS = 50;

const ReviewCategorySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    languages: { type: [String], default: ['English'] },
    scenarios: [
      {
        _id: false,
        key: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
      },
    ],
  },
  { timestamps: true }
);

ReviewCategorySchema.path('scenarios').validate((value: unknown[]) => {
  return !Array.isArray(value) || value.length <= MAX_SCENARIOS;
}, `A category can have at most ${MAX_SCENARIOS} scenarios`);

ReviewCategorySchema.index({ active: 1, name: 1 });

export default mongoose.models.ReviewCategory ||
  mongoose.model('ReviewCategory', ReviewCategorySchema);