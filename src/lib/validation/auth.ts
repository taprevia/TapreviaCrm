import { z } from 'zod';
import { emailField } from './common';
import { PASSWORD_MIN, PASSWORD_MAX, PASSWORD_POLICY_MESSAGE, isPasswordCompliant } from '@/lib/auth/password-policy';

/** Required password meeting the medium-strength policy, shared by register/change/reset. */
export const passwordField = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .refine(isPasswordCompliant, PASSWORD_POLICY_MESSAGE);

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: emailField,
  password: passwordField,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(PASSWORD_MAX),
  newPassword: passwordField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required').max(1024),
  newPassword: passwordField,
});