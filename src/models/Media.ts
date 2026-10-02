import mongoose, { Schema } from 'mongoose';

const MEDIA_CATEGORIES = [
  'avatar',
  'cover',
  'gallery',
  'product',
  'socialIcon',
  'virtualBackground',
  'other',
] as const;

export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

const MEDIA_STATUSES = ['pending', 'ready'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

const MediaSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cardId: { type: Schema.Types.ObjectId, ref: 'Card' },
    category: { type: String, enum: [...MEDIA_CATEGORIES], required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    bytes: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    mime: { type: String, required: true },
    // 'pending' rows are created by the presign flow before the client PUTs
    // the object; 'ready' once confirmed. Pending rows are auto-expired.
    status: { type: String, enum: [...MEDIA_STATUSES], default: 'ready' },
  },
  { timestamps: true, collection: 'media' }
);

MediaSchema.index({ userId: 1, createdAt: -1 });
MediaSchema.index({ key: 1 }, { unique: true });
MediaSchema.index({ userId: 1, category: 1 });
// Orphaned presign rows (upload never completed) are purged after 24h.
MediaSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { status: 'pending' } }
);

export default mongoose.models.Media || mongoose.model('Media', MediaSchema);
