import { z } from 'zod';
import { optionalEmailField, optionalUrlOrMediaPathSchema } from './common';

export const inquirySourceSchema = z.enum([
  'contact_form',
  'exchange_modal',
  'vcf_gate',
]);

export const inquiryStatusSchema = z.enum(['new', 'contacted', 'won', 'lost']);

/**
 * Public (unauthenticated visitor) submission.
 * All non-name fields may be omitted entirely; they are normalized to ''
 * so persistence always receives complete strings.
 */
export const publicInquirySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: optionalEmailField.optional(),
    phone: z.string().trim().max(20).optional(),
    message: z.string().trim().max(2000).optional(),
    attachmentUrl: optionalUrlOrMediaPathSchema.optional(),
    source: inquirySourceSchema.default('contact_form'),
  })
  .transform((v) => ({
    name: v.name,
    email: v.email ?? '',
    phone: v.phone ?? '',
    message: v.message ?? '',
    attachmentUrl: v.attachmentUrl ?? '',
    source: v.source,
  }));

/** Owner-side status update from dashboard. Transition legality enforced in route. */
export const inquiryStatusPatchSchema = z.object({
  status: inquiryStatusSchema,
  note: z.string().trim().max(1000).optional(),
});

export type PublicInquiryInput = z.infer<typeof publicInquirySchema>;
