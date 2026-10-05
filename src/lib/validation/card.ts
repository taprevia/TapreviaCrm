import { z } from 'zod';
import { sanitizeHtml } from '@/lib/sanitizer';
import {
  aliasSchema,
  optionalEmailField,
  optionalUrlOrMediaPathSchema,
  timeOrEmptySchema,
  urlOrMediaPathSchema,
} from './common';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const templateKeySchema = z.string().trim().min(1, 'Template is required').max(40);
export const cardKindSchema = z.enum(['profile', 'social', 'review']);
export const coverTypeSchema = z.enum(['image', 'color', 'video']);
export const coverStyleSchema = z.enum(['cover', 'banner', 'boxed']);
export const dayOfWeekSchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
export const reviewWritingStyleSchema = z.enum(['friendly', 'professional', 'casual', 'simple']);
export const reviewPreferredLengthSchema = z.enum(['short', 'medium', 'detailed']);

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

export const businessHourSchema = z.object({
  day: dayOfWeekSchema,
  enabled: z.boolean(),
  from: timeOrEmptySchema,
  to: timeOrEmptySchema,
});

export const socialLinkSchema = z.object({
  platform: z.string().trim().min(1).max(50),
  url: urlOrMediaPathSchema.refine((v) => v.startsWith('/') || /^https?:\/\//i.test(v), {
    message: 'Social URL must start with http(s):// or /',
  }),
  label: z.string().trim().max(100).optional(),
  iconUrl: z.string().max(2048).optional(),
});

const basicPartialSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: optionalEmailField.optional(),
  alternateEmail: optionalEmailField.optional(),
  phone: z.string().trim().max(20).optional(),
  alternatePhone: z.string().trim().max(20).optional(),
  dateOfBirth: z
    .union([
      z.literal(''),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    ])
    .optional(),
  company: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  defaultLanguage: z.string().trim().max(10).optional(),
});

const locationPartialSchema = z.object({
  type: z.enum(['link', 'embedded_map', 'latlng']).optional(),
  address: z.string().max(300).optional(),
  mapsUrl: optionalUrlOrMediaPathSchema.optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

export const bannerPartialSchema = z.object({
  title: z.string().max(200).optional(),
  url: optionalUrlOrMediaPathSchema.optional(),
  description: z.string().max(500).optional(),
  ctaLabel: z.string().max(60).optional(),
  show: z.boolean().optional(),
});

const configPartialSchema = z.object({
  displayLocalization: z.boolean().optional(),
  displayDownloadQrIcon: z.boolean().optional(),
  displayQrSection: z.boolean().optional(),
  displayAddToContact: z.boolean().optional(),
  hideStickyBar: z.boolean().optional(),
  displayWhatsAppShare: z.boolean().optional(),
  qrDownloadSize: z.number().int().min(100).max(500).optional(),
});

const galleryImageSchema = z.object({
  imageUrl: optionalUrlOrMediaPathSchema,
  caption: z.string().trim().max(120).optional(),
});

const serviceItemSchema = z.object({
  title: z.string().trim().min(1, 'Service title is required').max(120),
  description: z.string().trim().max(300).optional(),
});

const sectionsPartialSchema = z.object({
  header: z.boolean().optional(),
  contact: z.boolean().optional(),
  businessHours: z.boolean().optional(),
  map: z.boolean().optional(),
  banner: z.boolean().optional(),
  newsletterPopup: z.boolean().optional(),
});

const tagListSchema = z
  .array(z.string().trim().min(1, 'Tag cannot be empty').max(60))
  .max(12);

/** External http(s) destination or empty string — external redirects only, never media paths. */
export const externalUrlOrEmptySchema = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .refine(
    (v) => v === undefined || v === '' || /^https?:\/\//i.test(v),
    'URL must start with http(s)://'
  );

/** Google review URLs are external http(s) links only — never media paths. */
export const googleReviewUrlSchema = externalUrlOrEmptySchema;

export const reviewAssistantPartialSchema = z.object({
  enabled: z.boolean().optional(),
  googleReviewUrl: googleReviewUrlSchema,
  writingStyle: reviewWritingStyleSchema.optional(),
  preferredLength: reviewPreferredLengthSchema.optional(),
  languages: tagListSchema.optional(),
  feedbackTopics: tagListSchema.optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  // Business personalization for the template-based suggestions mode.
  category: z.string().trim().max(60).optional(),
  employees: tagListSchema.optional(),
  services: tagListSchema.optional(),
  keywords: tagListSchema.optional(),
});

// ─── Request schemas ─────────────────────────────────────────────────────────

export const createCardSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  urlAlias: aliasSchema.optional(),
  templateKey: templateKeySchema.optional(),
  kind: cardKindSchema.optional(),
  redirectUrl: externalUrlOrEmptySchema.optional(),
});

/**
 * Deep-partial update payload for editable card fields.
 * Nested objects are individually optional and their members optional so
 * routes can PATCH any subset (e.g. `{ config: { hideStickyBar: true } }`).
 */
export const updateCardSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    cardLabel: z.string().trim().max(80).optional(),
    urlAlias: aliasSchema.optional(),
    occupation: z.string().max(120).optional(),
    descriptionHtml: z
      .string()
      .max(20000)
      .optional()
      .transform((v) => (v === undefined || v === null ? undefined : sanitizeHtml(String(v)))),
    templateKey: templateKeySchema.optional(),
    kind: cardKindSchema.optional(),
    redirectUrl: externalUrlOrEmptySchema.optional(),
    isActive: z.boolean().optional(),
    coverType: coverTypeSchema.optional(),
    coverStyle: coverStyleSchema.optional(),
    coverValue: z.string().max(2048).optional(),
    profileImageUrl: optionalUrlOrMediaPathSchema.optional(),
    galleryImages: z.array(galleryImageSchema).max(30).optional(),
    services: z.array(serviceItemSchema).max(30).optional(),
    themeConfig: z
      .object({
        accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB').optional(),
        bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use #RRGGBB').optional(),
      })
      .optional(),
    basic: basicPartialSchema.optional(),
    location: locationPartialSchema.optional(),
    businessHours: z.array(businessHourSchema).max(7).optional(),
    socialLinks: z.array(socialLinkSchema).max(50).optional(),
    banner: bannerPartialSchema.optional(),
    privacyPolicyHtml: z.string().max(20000).optional(),
    termsHtml: z.string().max(20000).optional(),
    config: configPartialSchema.optional(),
    sections: sectionsPartialSchema.optional(),
    reviewAssistant: reviewAssistantPartialSchema.optional(),
  });

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
