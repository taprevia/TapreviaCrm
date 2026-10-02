import { z } from 'zod';
import { emailField } from './common';

/** "10:00 AM" / "2:30 pm" style slot labels. */
export const slotSchema = z
  .string()
  .trim()
  .regex(/^\d{1,2}:\d{2}\s?(AM|PM)$/i, 'Slot must look like "10:00 AM"');

export const appointmentStatusSchema = z.enum([
  'pending',
  'confirmed',
  'cancelled',
  'completed',
]);

export const createAppointmentSchema = z.object({
  visitorName: z.string().trim().min(1, 'Name is required').max(100),
  visitorEmail: emailField,
  visitorPhone: z.string().trim().max(20).optional(),
  date: z.coerce.date(),
  slot: slotSchema,
  service: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

/** Status transitions (pending→confirmed→completed / →cancelled) validated in route. */
export const appointmentPatchSchema = z.object({
  status: appointmentStatusSchema,
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
