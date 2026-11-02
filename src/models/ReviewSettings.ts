import mongoose, { Schema } from 'mongoose';
import { REVIEW_SETTINGS_SCHEMA_VERSION } from '@/lib/review-settings-defaults';

export const REVIEW_SETTINGS_WRITING_STYLES = [
  'friendly',
  'professional',
  'casual',
  'simple',
] as const;
export const REVIEW_SETTINGS_PREFERRED_LENGTHS = [
  'short',
  'medium',
  'detailed',
] as const;
export const REVIEW_SETTINGS_MODES = ['fixed', 'varied'] as const;

const MAX_URL_LENGTH = 2048;
const MAX_WELCOME_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 60;
const MAX_LANGUAGES = 12;
const MAX_LANGUAGE_LENGTH = 40;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 50;

function isCentralReviewUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    // Reject embedded credentials in the public destination URL.
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

function validateLanguageArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_LANGUAGES) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return false;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_LANGUAGE_LENGTH) return false;
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
  }
  return true;
}

function validateTagArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_TAGS) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return false;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_TAG_LENGTH) return false;
    if (seen.has(trimmed)) return false;
    seen.add(trimmed);
  }
  return true;
}

const ReviewSettingsSchema = new Schema(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    schemaVersion: {
      type: Number,
      default: REVIEW_SETTINGS_SCHEMA_VERSION,
      enum: [REVIEW_SETTINGS_SCHEMA_VERSION],
      required: true,
    },
    general: {
      enabled: { type: Boolean, default: false },
      googleReviewUrl: {
        type: String,
        default: '',
        maxlength: MAX_URL_LENGTH,
        validate: {
          validator: isCentralReviewUrl,
          message: 'Google Review URL must be an empty or valid http(s) URL without credentials',
        },
      },
      welcomeMessage: {
        type: String,
        default: '',
        maxlength: MAX_WELCOME_LENGTH,
      },
      businessName: {
        type: String,
        default: '',
        trim: true,
        maxlength: 120,
      },
    },
    content: {
      category: {
        type: String,
        default: '',
        trim: true,
        maxlength: MAX_CATEGORY_LENGTH,
      },
      languages: {
        type: [String],
        default: [],
        validate: {
          validator: validateLanguageArray,
          message: `Languages must be unique, 1–${MAX_LANGUAGE_LENGTH} characters, and at most ${MAX_LANGUAGES} entries`,
        },
      },
      writingStyle: {
        type: String,
        enum: [...REVIEW_SETTINGS_WRITING_STYLES],
        default: 'friendly',
      },
      preferredLength: {
        type: String,
        enum: [...REVIEW_SETTINGS_PREFERRED_LENGTHS],
        default: 'medium',
      },
      styleMode: {
        type: String,
        enum: [...REVIEW_SETTINGS_MODES],
        default: 'fixed',
      },
      lengthMode: {
        type: String,
        enum: [...REVIEW_SETTINGS_MODES],
        default: 'fixed',
      },
      feedbackTopics: {
        type: [String],
        default: [],
        validate: {
          validator: validateTagArray,
          message: `Feedback topics must be unique, 1–${MAX_TAG_LENGTH} characters, and at most ${MAX_TAGS} entries`,
        },
      },
      services: {
        type: [String],
        default: [],
        validate: {
          validator: validateTagArray,
          message: `Services must be unique, 1–${MAX_TAG_LENGTH} characters, and at most ${MAX_TAGS} entries`,
        },
      },
      employees: {
        type: [String],
        default: [],
        validate: {
          validator: validateTagArray,
          message: `Employees must be unique, 1–${MAX_TAG_LENGTH} characters, and at most ${MAX_TAGS} entries`,
        },
      },
      keywords: {
        type: [String],
        default: [],
        validate: {
          validator: validateTagArray,
          message: `Keywords must be unique, 1–${MAX_TAG_LENGTH} characters, and at most ${MAX_TAGS} entries`,
        },
      },
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Enabled central settings must have at least one language. The API also
// validates the merged configuration; this model guard protects direct writes.
ReviewSettingsSchema.pre('validate', function (next) {
  const enabled = Boolean((this as unknown as { general?: { enabled?: boolean } }).general?.enabled);
  const languages = (this as unknown as { content?: { languages?: string[] } }).content?.languages ?? [];
  if (enabled && languages.length === 0) {
    this.invalidate('content.languages', 'At least one language is required when Review Assistant is enabled');
  }
  next();
});

ReviewSettingsSchema.index({ businessId: 1 }, { unique: true });

export default mongoose.models.ReviewSettings ||
  mongoose.model('ReviewSettings', ReviewSettingsSchema);
