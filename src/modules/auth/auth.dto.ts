import { z } from 'zod';

/**
 * Emails are stored and looked up lowercase everywhere (see `User` model's
 * `beforeValidate` hook) — normalize at the validation boundary too, so a
 * differently-cased login/OTP/reset request still matches the stored account.
 */
const emailSchema = z.string().trim().email().toLowerCase();

export const RegisterSchema = z.object({
  email: emailSchema,
  password: z.string().min(8),
  name: z.string().min(1),
  phone: z.string().optional(),
});

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string(),
});

export const RequestOtpSchema = z.object({
  email: emailSchema,
});

export const VerifyOtpSchema = RequestOtpSchema.extend({
  code: z.string().regex(/^\d{6}$/),
});

export const RefreshSchema = z.object({
  refreshToken: z.string(),
});

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});

export const ResetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(8),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
});

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
});

export type RegisterRequest = z.infer<typeof RegisterSchema>;
export type LoginRequest = z.infer<typeof LoginSchema>;
export type RequestOtpRequest = z.infer<typeof RequestOtpSchema>;
export type VerifyOtpRequest = z.infer<typeof VerifyOtpSchema>;
export type RefreshRequest = z.infer<typeof RefreshSchema>;
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordSchema>;
export type ResetPasswordRequest = z.infer<typeof ResetPasswordSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordSchema>;
export type VerifyEmailRequest = z.infer<typeof VerifyEmailSchema>;
