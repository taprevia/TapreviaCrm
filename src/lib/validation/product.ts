import { z } from 'zod';
import { currencyCodeSchema, optionalUrlOrMediaPathSchema } from './common';

export const createProductSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  description: z.string().max(2000).optional(),
  /**
   * Integer minor units (paise) — never floats.
   *
   * The customer Product form intentionally has no price control (price UI was
   * removed), so creation must succeed without a price. The Product model
   * already defaults to 0; this aligns the API schema with that stored default.
   * Explicit prices from other clients are still validated and preserved.
   */
  priceMinor: z.number().int().min(0).default(0),
  currency: currencyCodeSchema.default('INR'),
  category: z.string().trim().max(80).optional(),
  imageUrl: optionalUrlOrMediaPathSchema.optional(),
  active: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
