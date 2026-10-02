import { z } from 'zod';
import { currencyCodeSchema, optionalUrlOrMediaPathSchema } from './common';

export const createProductSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  description: z.string().max(2000).optional(),
  /** Integer minor units (paise) — never floats. */
  priceMinor: z.number().int().min(0),
  currency: currencyCodeSchema.default('INR'),
  category: z.string().trim().max(80).optional(),
  imageUrl: optionalUrlOrMediaPathSchema.optional(),
  active: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
