import { randomInt } from 'node:crypto';

/**
 * Which applied coupons a new one has to replace: all of them if it can't stack, otherwise
 * any that can't stack with it, or that share its slot (one platform coupon, one per seller).
 */
export function couponsReplacedBy<T extends { code: string; stackable?: boolean | null; vendorId?: string | null }>(
  candidate: { code: string; stackable?: boolean | null; vendorId?: string | null },
  applied: T[],
): T[] {
  const others = applied.filter((coupon) => coupon.code !== candidate.code);
  if (!candidate.stackable) return others;
  return others.filter(
    (coupon) => !coupon.stackable || (coupon.vendorId ?? null) === (candidate.vendorId ?? null),
  );
}

/** No 0/O or 1/I/L: codes get read out and typed by hand. */
const COUPON_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const COUPON_CODE_RANDOM_LENGTH = 10;

/** Unguessable: these codes are worth money, so they come from a secure random source. */
export function generateCouponCode(prefix = 'CPN'): string {
  let random = '';
  for (let i = 0; i < COUPON_CODE_RANDOM_LENGTH; i += 1) {
    random += COUPON_CODE_ALPHABET[randomInt(COUPON_CODE_ALPHABET.length)];
  }
  return `${prefix}${random}`;
}
