import { z } from 'zod';
import { objectIdSchema } from './common';

export const mediaCategorySchema = z.enum([
  'avatar',
  'cover',
  'gallery',
  'product',
  'socialIcon',
  'virtualBackground',
  'other',
]);

/** Metadata sent alongside a multipart upload. */
export const uploadMetaSchema = z.object({
  category: mediaCategorySchema,
  cardId: objectIdSchema.optional(),
});

export type UploadMetaInput = z.infer<typeof uploadMetaSchema>;
