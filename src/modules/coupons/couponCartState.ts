import { Coupon } from '@database/models/coupon.model';
import { COUPON_STATUS } from '@core/constants/statuses';
import { ERROR_CODES, ERROR_MESSAGES } from '@core/constants/errors';
import {
  validateCoupon,
  validateCouponSet,
  type CartLineForCoupon,
  type ValidateCouponSetResult,
} from './couponEngine';
import { customerCouponName } from './coupon.utils';

export type InactiveCartCoupon = {
  code: string;
  name: string;
  reason: string;
  reasonCode: string | null;
  /** Can never work again (expired, rejected, used up): dropped on the next apply or remove. */
  dead: boolean;
};

export type CartCouponState = {
  result: ValidateCouponSetResult;
  inactive: InactiveCartCoupon[];
};

type ShippingInput = {
  total: number;
  byVendor: Record<string, number>;
  unknown?: boolean;
};

function isDeadCoupon(coupon: Coupon | undefined, now: Date): boolean {
  if (!coupon) return true;
  const finished: string[] = [COUPON_STATUS.ARCHIVED, COUPON_STATUS.REJECTED, COUPON_STATUS.EXPIRED];
  if (finished.includes(coupon.status) || coupon.endDate < now) return true;
  return coupon.usageLimitTotal != null && Number(coupon.usedCount ?? 0) >= Number(coupon.usageLimitTotal);
}

/** What a ₹0 coupon needs before it gives anything, in the customer's terms. */
export function zeroBenefitMessage(type: string): string {
  if (type === 'BOGO') return ERROR_MESSAGES.COUPON_BOGO_NEEDS_MORE;
  if (type === 'FREE_SHIPPING') return ERROR_MESSAGES.COUPON_SHIPPING_ALREADY_FREE;
  return ERROR_MESSAGES.COUPON_NO_BENEFIT;
}

/**
 * Which of the cart's coupons apply right now, and why the others don't. Read-only: a coupon
 * that fails for now (paused, cart below its minimum) stays on the cart and applies again
 * once it can, and one bad coupon doesn't take the others with it.
 */
export async function evaluateCartCoupons(input: {
  codes: string[];
  userId: string;
  lines: CartLineForCoupon[];
  shipping: ShippingInput;
}): Promise<CartCouponState> {
  const { codes, userId, lines, shipping } = input;
  const validateSet = (setCodes: string[]) =>
    validateCouponSet({
      codes: setCodes,
      userId,
      lines,
      shippingTotal: shipping.total,
      shippingByVendor: shipping.byVendor,
      shippingUnknown: shipping.unknown,
    });
  if (codes.length === 0 || lines.length === 0) return { result: await validateSet([]), inactive: [] };

  const rows = await Coupon.findAll({ where: { code: codes } });
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const now = new Date();
  const inactive: InactiveCartCoupon[] = [];
  const addInactive = (code: string, reason: string, reasonCode: string | null) => {
    const coupon = byCode.get(code);
    inactive.push({
      code,
      name: coupon ? customerCouponName(coupon) : code,
      reason,
      reasonCode,
      dead: isDeadCoupon(coupon, now),
    });
  };

  let applicable: string[] = [];
  for (const code of codes) {
    const alone = await validateCoupon({
      code,
      userId,
      lines,
      shippingTotal: shipping.total,
      shippingByVendor: shipping.byVendor,
      shippingUnknown: shipping.unknown,
    });
    if (!alone.valid) {
      addInactive(code, alone.reason ?? ERROR_MESSAGES.COUPON_INVALID, alone.reasonCode);
    } else if (alone.zeroBenefit && alone.coupon?.type !== 'FREE_SHIPPING') {
      // Free shipping stays on: another address or delivery method may cost something.
      addInactive(code, zeroBenefitMessage(alone.coupon?.type ?? ''), ERROR_CODES.COUPON_ZERO_BENEFIT);
    } else {
      applicable.push(code);
    }
  }

  // Together they may clash: the latest added gives way.
  let result = await validateSet(applicable);
  while (!result.valid && applicable.length > 1) {
    const dropped = applicable[applicable.length - 1]!;
    applicable = applicable.slice(0, -1);
    addInactive(dropped, result.reason ?? ERROR_MESSAGES.COUPON_STACK, result.reasonCode);
    result = await validateSet(applicable);
  }
  return { result, inactive };
}
