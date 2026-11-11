import { z } from 'zod';

/**
 * Phone numbers — the same rule as the web form (shared/utils/validation/phoneNumber):
 * 10 digits starting 6–9 (an Indian mobile) or 8–15 digits (a landline or an
 * international number), after removing spaces, dashes, brackets, +91 and a
 * leading 0. Junk such as "abc" or "12" is refused.
 */
const INDIAN_MOBILE = /^[6-9]\d{9}$/;
const ANY_PHONE = /^\d{8,15}$/;
const PHONE_CHARACTERS = /^[\d\s()+.-]+$/;
export const PHONE_INVALID = 'Enter a valid phone number';

export function normalisePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  const withoutCountryCode = digits.startsWith('91') && digits.length > 10 ? digits.slice(2) : digits;
  return withoutCountryCode.replace(/^0+/, '');
}

export function isValidPhoneNumber(value: string): boolean {
  const raw = value.trim();
  if (!PHONE_CHARACTERS.test(raw)) return false;
  const digits = normalisePhoneNumber(raw);
  return INDIAN_MOBILE.test(digits) || ANY_PHONE.test(digits);
}

/** Optional phone: blank or missing is allowed; anything typed must be a real number. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(20)
  .refine((value) => value === '' || isValidPhoneNumber(value), PHONE_INVALID);
