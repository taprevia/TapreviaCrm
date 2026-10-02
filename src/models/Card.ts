import mongoose, { Schema } from 'mongoose';
import { DEFAULT_TEMPLATE_KEY } from '@/lib/card-templates';

const DAY_VALUES = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const DEFAULT_BUSINESS_HOURS: Array<{
  day: (typeof DAY_VALUES)[number];
  enabled: boolean;
  from: string;
  to: string;
}> = DAY_VALUES.map((day) => ({ day, enabled: false, from: '', to: '' }));

const BusinessHourSchema = new Schema(
  {
    day: { type: String, enum: [...DAY_VALUES], required: true },
    enabled: { type: Boolean, default: false },
    from: { type: String, default: '' },
    to: { type: String, default: '' },
  },
  { _id: false }
);

const SocialLinkSchema = new Schema(
  {
    platform: { type: String, required: true },
    url: { type: String, required: true },
    label: { type: String, default: '' },
    iconUrl: { type: String, default: '' },
    clicks: { type: Number, default: 0 },
  },
  { _id: false }
);

const REVIEW_STYLES = ['friendly', 'professional', 'casual', 'simple'] as const;
const REVIEW_LENGTHS = ['short', 'medium', 'detailed'] as const;

const ReviewAssistantSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    googleReviewUrl: { type: String, default: '' },
    writingStyle: { type: String, enum: [...REVIEW_STYLES], default: 'friendly' },
    preferredLength: { type: String, enum: [...REVIEW_LENGTHS], default: 'medium' },
    languages: { type: [String], default: ['English'] },
    feedbackTopics: { type: [String], default: [] },
    welcomeMessage: { type: String, default: '' },
    // Business personalization for the template-based suggestions mode.
    category: { type: String, default: '', trim: true },
    employees: { type: [String], default: [] },
    services: { type: [String], default: [] },
    keywords: { type: [String], default: [] },
  },
  { _id: false }
);

const CARD_KINDS = ['profile', 'social', 'review'] as const;

const ServiceItemSchema = new Schema(
  {
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { _id: false }
);

const CardSchema = new Schema(
  {
    // ── Physical card identity ──
    cardUid: { type: String, required: true, unique: true, trim: true },
    // Audit trail of UIDs this physical record has carried (card replacement).
    previousCardUids: { type: [String], default: [] },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    routeSlug: { type: String, default: '', lowercase: true, trim: true },
    assignedUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['unassigned', 'active', 'suspended'],
      default: 'unassigned',
    },
    setupComplete: { type: Boolean, default: false },
    totalTaps: { type: Number, default: 0 },

    // ── Digital profile (absorbed from former Vcard) ──
    // Null until the physical card is bound to a customer account.
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    urlAlias: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    // Human-readable public URL path ("{business-slug}/{product-slug}[-N]").
    // Additive field, sparse-unique: unset until backfilled/assigned.
    publicSlug: {
      type: String,
      lowercase: true,
      trim: true,
    },
    name: { type: String, default: 'Unassigned Card', trim: true },
    cardLabel: { type: String, default: '' },
    occupation: { type: String, default: '' },
    descriptionHtml: { type: String, default: '' },
    templateKey: {
      type: String,
      default: DEFAULT_TEMPLATE_KEY,
    },
    // Primary digital experience (default "profile" = legacy behavior).
    kind: { type: String, enum: [...CARD_KINDS], default: 'profile' },
    // Destination for redirect-style cards (e.g. social cards → platform).
    redirectUrl: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    coverType: {
      type: String,
      enum: ['image', 'color', 'video'],
      default: 'image',
    },
    coverStyle: {
      type: String,
      enum: ['cover', 'banner', 'boxed'],
      default: 'cover',
    },
    coverValue: { type: String, default: '' },
    profileImageUrl: { type: String, default: '' },
    galleryImages: [
      {
        _id: false,
        imageUrl: { type: String, default: '' },
        caption: { type: String, default: '' },
      },
    ],
    services: { type: [ServiceItemSchema], default: [] },

    themeConfig: {
      accentColor: { type: String, default: '#2563EB' },
      bgColor: { type: String, default: '#FFFFFF' },
    },

    basic: {
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      email: { type: String, default: '' },
      alternateEmail: { type: String, default: '' },
      phone: { type: String, default: '' },
      alternatePhone: { type: String, default: '' },
      dateOfBirth: { type: Date, default: null },
      company: { type: String, default: '' },
      jobTitle: { type: String, default: '' },
      defaultLanguage: { type: String, default: 'en' },
    },

    location: {
      type: {
        type: String,
        enum: ['link', 'embedded_map', 'latlng'],
        default: 'link',
      },
      address: { type: String, default: '' },
      mapsUrl: { type: String, default: '' },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    businessHours: {
      type: [BusinessHourSchema],
      default: () => DEFAULT_BUSINESS_HOURS.map((d) => ({ ...d })),
    },
    socialLinks: { type: [SocialLinkSchema], default: [] },

    banner: {
      title: { type: String, default: '' },
      url: { type: String, default: '' },
      description: { type: String, default: '' },
      ctaLabel: { type: String, default: '' },
      show: { type: Boolean, default: false },
    },

    privacyPolicyHtml: { type: String, default: '' },
    termsHtml: { type: String, default: '' },

    config: {
      displayLocalization: { type: Boolean, default: true },
      displayDownloadQrIcon: { type: Boolean, default: true },
      displayQrSection: { type: Boolean, default: true },
      displayAddToContact: { type: Boolean, default: true },
      hideStickyBar: { type: Boolean, default: false },
      displayWhatsAppShare: { type: Boolean, default: true },
      qrDownloadSize: { type: Number, default: 200 },
    },

    sections: {
      header: { type: Boolean, default: true },
      contact: { type: Boolean, default: true },
      businessHours: { type: Boolean, default: true },
      map: { type: Boolean, default: true },
      banner: { type: Boolean, default: true },
      newsletterPopup: { type: Boolean, default: true },
    },

    stats: {
      taps: { type: Number, default: 0 },
    },

    reviewAssistant: { type: ReviewAssistantSchema, default: () => ({}) },

    // ── Product destination configuration (dynamic, mutable) ──
    instagramConfig: {
      username: { type: String, default: '' },
      profileUrl: { type: String, default: '' },
      reelsUrl: { type: String, default: '' },
      postsUrl: { type: String, default: '' },
      dmUrl: { type: String, default: '' },
      shopUrl: { type: String, default: '' },
    },
    whatsappConfig: {
      phoneNumber: { type: String, default: '' },
      defaultMessage: { type: String, default: '' },
    },
    linkedinConfig: {
      profileUrl: { type: String, default: '' },
      resumeUrl: { type: String, default: '' },
    },
    facebookConfig: {
      profileUrl: { type: String, default: '' },
      pageUrl: { type: String, default: '' },
      messengerUrl: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

CardSchema.index({ userId: 1 });
CardSchema.index({ assignedUserId: 1 });
CardSchema.index({ urlAlias: 1 });
CardSchema.index({ status: 1 });
CardSchema.index({ routeSlug: 1 }, { unique: true, sparse: true });
CardSchema.index({ publicSlug: 1 }, { unique: true, sparse: true });

export default mongoose.models.Card || mongoose.model('Card', CardSchema);
