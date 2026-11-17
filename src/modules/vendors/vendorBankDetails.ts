import { z } from 'zod';
import { ValidationError } from '@core/errors/ValidationError';

/** 9–18 digits, no spaces: Indian bank account numbers. */
const ACCOUNT_NUMBER = /^\d{9,18}$/;
/** 4 letters, a zero, then 6 letters or digits. */
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * Shape of the bank account a payout is sent to. Only enforced when the details actually
 * change, so a vendor whose older details predate these rules can still save unrelated
 * settings, but cannot save a new account that a transfer would reject.
 */
export const BankDetailsSchema = z
  .object({
    accountHolderName: optionalText(120),
    bankName: optionalText(120),
    accountNumber: z
      .string()
      .trim()
      .regex(ACCOUNT_NUMBER, 'Account number must be 9 to 18 digits')
      .optional(),
    ifscCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => IFSC.test(value), 'Enter a valid 11-character IFSC code')
      .optional(),
  })
  .passthrough();

const sameDetails = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

/** Returns the normalised details, or throws a validation error when a changed account is malformed. */
export function validateBankDetailsChange(
  next: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (sameDetails(next, stored)) return next;
  const parsed = BankDetailsSchema.safeParse(next);
  if (!parsed.success) throw new ValidationError(parsed.error.flatten());
  return parsed.data as Record<string, unknown>;
}

/** The account number with all but its last four digits hidden, for staff who may not see it. */
export function maskBankDetails<T extends { bankDetails?: unknown }>(vendor: T): T {
  const details = vendor.bankDetails as Record<string, unknown> | null | undefined;
  if (!details || typeof details.accountNumber !== 'string') return vendor;
  return {
    ...vendor,
    bankDetails: { ...details, accountNumber: `••••${details.accountNumber.slice(-4)}` },
  };
}
