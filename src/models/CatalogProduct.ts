import mongoose, { Schema } from 'mongoose';

export const CATALOG_CATEGORIES = ['card', 'standee', 'other'] as const;

/**
 * Core software experience — exactly one of the four experiences. Independent
 * of the physical-asset `category` (a `standee`-category product is a
 * `standee` experience; a `card`-category product is a profile/social/review
 * experience). Legacy stored values (`card`, `multi-standee`) are mapped in
 * src/lib/feature-keys.ts:resolveExperience().
 */
export const CATALOG_KINDS = ['profile', 'social', 'review', 'standee'] as const;

const CatalogProductSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    category: { type: String, enum: [...CATALOG_CATEGORIES], required: true },
    // Product experience type; independent of the physical-asset `category`.
    kind: { type: String, enum: [...CATALOG_KINDS], default: 'profile' },
    // Combo composition: resolved into concrete assets at assignment time.
    components: [
      {
        _id: false,
        catalogProductId: { type: Schema.Types.ObjectId, ref: 'CatalogProduct', default: null },
        quantity: { type: Number, min: 1, max: 99, default: 1 },
      },
    ],
    // Product-level override for the FIXED experience rules: only
    // `social.max` (1–4, the social-links limit) is honoured by
    // resolveFeatureAccess(). Other keys are ignored.
    features: {
      type: Map,
      of: new Schema(
        {
          enabled: { type: Boolean, default: true },
          max: { type: Number, min: 1, max: 4 },
        },
        { _id: false }
      ),
    },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

CatalogProductSchema.index({ active: 1, sortOrder: 1 });
CatalogProductSchema.index({ category: 1 });
CatalogProductSchema.index({ kind: 1 });

export default mongoose.models.CatalogProduct ||
  mongoose.model('CatalogProduct', CatalogProductSchema);
