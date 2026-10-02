import { z } from 'zod';

// ─── URL validation helper ─────────────────────────────────────────────────

function isSafeUrl(v: string): boolean {
  if (!v || v.length > 2048) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const safeUrl = z
  .string()
  .max(2048)
  .refine(isSafeUrl, 'Must be a valid http(s) URL');

const optionalSafeUrl = z
  .string()
  .max(2048)
  .refine((v) => v === '' || isSafeUrl(v), 'Must be a valid http(s) URL');

// ─── Social Card Config ────────────────────────────────────────────────────

export const socialCardConfigSchema = z.object({
  destinationUrl: safeUrl,
});

// ─── Instagram Config ──────────────────────────────────────────────────────

export const instagramConfigSchema = z.object({
  username: z.string().min(1, 'Username is required').max(100),
  profileUrl: safeUrl,
  reelsUrl: optionalSafeUrl.default(''),
  postsUrl: optionalSafeUrl.default(''),
  dmUrl: optionalSafeUrl.default(''),
  shopUrl: optionalSafeUrl.default(''),
});

// ─── Google Review Config ──────────────────────────────────────────────────

export const googleReviewConfigSchema = z.object({
  googleReviewUrl: safeUrl,
  businessName: z.string().min(1, 'Business name is required').max(200).optional(),
  mapsUrl: optionalSafeUrl.default(''),
});

// ─── WhatsApp Config ───────────────────────────────────────────────────────

export const whatsappConfigSchema = z.object({
  phoneNumber: z
    .string()
    .min(10, 'Phone number is required')
    .max(20)
    .regex(/^\+?[0-9]+$/, 'Phone number must contain only digits and optional + prefix'),
  defaultMessage: z.string().max(500).default(''),
});

// ─── LinkedIn Config ───────────────────────────────────────────────────────

export const linkedinConfigSchema = z.object({
  profileUrl: safeUrl,
  resumeUrl: optionalSafeUrl.default(''),
});

// ─── Facebook Config ───────────────────────────────────────────────────────

export const facebookConfigSchema = z.object({
  profileUrl: safeUrl,
  pageUrl: optionalSafeUrl.default(''),
  messengerUrl: optionalSafeUrl.default(''),
});

// ─── Standee Slot Config ───────────────────────────────────────────────────

export const standeeSlotConfigSchema = z.object({
  slot: z.number().int().min(1).max(10),
  destinationUrl: safeUrl,
  // Optional platform label override for display only (destination type).
  label: z.string().max(100).optional(),
});

// ─── Generic Config Update (any product type) ──────────────────────────────

export const updateProductConfigSchema = z.object({
  // For social cards
  destinationUrl: z.string().max(2048).optional(),

  // Public display name shown on standee panel/QR picker pages.
  displayName: z.string().max(120).optional(),

  // For standee single-slot updates (multi-profile standees)
  slotConfig: standeeSlotConfigSchema.optional(),

  // For Instagram cards
  instagram: z.object({
    username: z.string().min(1).max(100).optional(),
    profileUrl: z.string().max(2048).optional(),
    reelsUrl: z.string().max(2048).optional(),
    postsUrl: z.string().max(2048).optional(),
    dmUrl: z.string().max(2048).optional(),
    shopUrl: z.string().max(2048).optional(),
  }).optional(),

  // For Google Review cards
  googleReview: z.object({
    googleReviewUrl: z.string().max(2048).optional(),
    businessName: z.string().max(200).optional(),
    mapsUrl: z.string().max(2048).optional(),
  }).optional(),

  // For WhatsApp cards
  whatsapp: z.object({
    phoneNumber: z.string().min(10).max(20).optional(),
    defaultMessage: z.string().max(500).optional(),
  }).optional(),

  // For LinkedIn cards
  linkedin: z.object({
    profileUrl: z.string().max(2048).optional(),
    resumeUrl: z.string().max(2048).optional(),
  }).optional(),

  // For Facebook cards
  facebook: z.object({
    profileUrl: z.string().max(2048).optional(),
    pageUrl: z.string().max(2048).optional(),
    messengerUrl: z.string().max(2048).optional(),
  }).optional(),
});

export type UpdateProductConfigInput = z.infer<typeof updateProductConfigSchema>;
