import { z } from 'zod';
import { emailField } from './common';
import { passwordField } from './auth';

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit verification code');

export const requestPasswordResetOtpSchema = z.object({
  email: emailField,
});

export const verifyPasswordResetOtpSchema = z.object({
  email: emailField,
  otp: otpCodeSchema,
});

export const completePasswordResetSchema = z.object({
  // Opaque 32-byte random grant rendered as hex. Never placed in a URL.
  grant: z.string().trim().min(32).max(128).regex(/^[a-f0-9]+$/i, 'Invalid reset authorization'),
  newPassword: passwordField,
});

export type RequestPasswordResetOtpInput = z.infer<typeof requestPasswordResetOtpSchema>;
export type VerifyPasswordResetOtpInput = z.infer<typeof verifyPasswordResetOtpSchema>;
export type CompletePasswordResetInput = z.infer<typeof completePasswordResetSchema>;
