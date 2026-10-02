import { z } from 'zod';
import { currencyCodeSchema } from './common';

/** PATCH-able general tenant settings — every field optional. */
export const generalSettingsSchema = z.object({
  currency: currencyCodeSchema.optional(),
  timeFormat12h: z.boolean().optional(),
  newsletterModalDelaySeconds: z.number().int().min(0).max(60).optional(),
  inquiryAttachmentsEnabled: z.boolean().optional(),
  askDetailsBeforeDownload: z.boolean().optional(),
  enablePWA: z.boolean().optional(),
});

/**
 * OpenAI settings. `apiKey` arrives as plaintext over TLS and must be
 * immediately persisted via encryptSecret() into `openai.apiKeyEnc` —
 * it is never stored or echoed in plaintext.
 */
export const openaiSettingsSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().max(200).optional(),
  model: z.string().trim().max(100).optional(),
  dailyLimit: z.number().int().min(0).max(100_000).optional(),
});

/**
 * Body of PATCH /api/settings — every section and leaf optional.
 * `openai` is partially applied so `enabled` can be sent alone;
 * a non-empty `apiKey` is encrypted server-side before persistence.
 */
export const updateTenantSettingsSchema = z.object({
  general: generalSettingsSchema.optional(),
  openai: openaiSettingsSchema.partial().optional(),
});

export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;
export type OpenaiSettingsInput = z.infer<typeof openaiSettingsSchema>;
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
