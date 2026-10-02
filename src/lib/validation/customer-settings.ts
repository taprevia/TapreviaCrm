import { z } from 'zod';

/**
 * Body of PATCH /api/customer/settings — per-customer preference persisted on
 * the User doc, distinct from the tenant-wide /api/settings.
 * Every field optional so clients can send terse patches.
 */
export const customerSettingsSchema = z.object({
  isNewsletterEnabled: z.boolean().optional(),
});

export type CustomerSettingsInput = z.infer<typeof customerSettingsSchema>;