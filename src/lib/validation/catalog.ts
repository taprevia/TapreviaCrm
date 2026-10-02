import { z } from 'zod';
import {
  currencyCodeSchema,
  emailField,
  objectIdSchema,
  optionalUrlOrMediaPathSchema,
} from './common';
import { passwordField } from './auth';

export const catalogProductKindSchema = z.enum(['profile', 'social', 'review', 'standee']);

export const catalogFeatureSchema = z.object({
  enabled: z.boolean().optional(),
  max: z.number().int().min(1).max(4).optional(),
});

/**
 * Product-level override for the fixed experience rules. Only the social-links
 * limit is configurable per product (1–4); the individual feature toggles from
 * the old model are obsolete — unknown keys are stripped.
 */
export const featuresSchema = z.object({
  social: catalogFeatureSchema.optional(),
});

export const comboComponentSchema = z.object({
  catalogProductId: objectIdSchema,
  quantity: z.number().int().min(1).max(99).default(1),
});

const catalogBase = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug may contain lowercase letters, digits and hyphens')
    .optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(['card', 'standee', 'other']),
  kind: catalogProductKindSchema.default('profile'),
  components: z.array(comboComponentSchema).max(20).default([]),
  // Price is optional — billing is handled separately
  price: z.number().min(0).optional().default(0),
  currency: currencyCodeSchema.default('INR'),
  imageUrl: optionalUrlOrMediaPathSchema.optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  features: featuresSchema.optional(),
});

export const createCatalogSchema = catalogBase;

export const updateCatalogSchema = catalogBase.partial();

/** Material options for NFC cards. */
export const cardMaterialSchema = z.enum(['pvc', 'metal', 'wooden']);

export const assignProductSchema = z.object({
  catalogProductId: objectIdSchema,
  quantity: z.number().int().min(1).max(99).default(1),
  cardUid: z.string().trim().min(1).max(64).optional(),
  platforms: z.array(z.string()).optional(),
  notes: z.string().max(500).optional(),
  material: cardMaterialSchema.default('pvc'),
});

export type CreateCatalogInput = z.infer<typeof createCatalogSchema>;
export type UpdateCatalogInput = z.infer<typeof updateCatalogSchema>;
export type AssignProductInput = z.infer<typeof assignProductSchema>;
export type CardMaterial = z.infer<typeof cardMaterialSchema>;

/**
 * Payload for transactional admin customer creation.
 *
 * Cards are bound by entering the physical NFC Card UID directly at creation
 * time — no inventory record is required. The server re-validates every UID
 * (normalized, unique within the request, not already bound to another
 * customer) before creating anything.
 */
export const createCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Invalid email address').max(254),
  password: passwordField,
  // Optional explicit company public URL slug ("{slug}/{product-slug}"). The
  // server normalizes it through the shared generateSlug utility and allocates
  // via the monotonic bizslug counter — an admin-supplied value is the base,
  // never silently replaced with Card.name. When omitted the slug is derived
  // from the customer name (existing automatic behavior).
  urlSlug: z.string().trim().min(1).max(40).optional(),
  products: z.array(assignProductSchema).min(1, 'At least one product is required').max(50),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * PATCH /api/admin/users/:id — credential edits. Every field optional; at
 * least one must be present (enforced in the route). Phone stays on the User
 * doc so it travels with the account rather than the editable Profile.
 */
export const updateCustomerCredentialsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).optional(),
  email: emailField.optional(),
  phone: z
    .string()
    .trim()
    .max(30, 'Phone must be at most 30 characters')
    .optional(),
});

export type UpdateCustomerCredentialsInput = z.infer<typeof updateCustomerCredentialsSchema>;

/**
 * POST /api/admin/users/:id/reset-password payload.
 * - mode 'email' (default): mints a reset token and emails the reset link.
 * - mode 'temp': directly sets the supplied temporary password (re-hashed by
 *   the User pre-save hook before storage).
 */
export const adminResetPasswordSchema = z.object({
  mode: z.enum(['email', 'temp']).default('email'),
  password: passwordField.optional(),
});

export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
