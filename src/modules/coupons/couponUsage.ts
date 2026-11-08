import type { Transaction } from 'sequelize';
import { Cart } from '@database/models/cart.model';
import { Coupon } from '@database/models/coupon.model';
import { CouponUsage } from '@database/models/couponUsage.model';
import { discountAppliedFromBreakdown, type AppliedCouponBreakdownEntry } from './couponEngine';
import { customerCouponName } from './coupon.utils';

export async function recordCouponUsage(params: {
  couponId: string;
  userId: string;
  orderId: string;
  discountApplied: number;
  customerDiscountApplied?: number | null;
  actorId?: string;
  transaction?: Transaction;
}): Promise<{ created: boolean }> {
  const existing = await CouponUsage.findOne({
    where: { couponId: params.couponId, orderId: params.orderId },
    transaction: params.transaction,
  });
  if (existing) {
    return { created: false };
  }

  await CouponUsage.create(
    {
      couponId: params.couponId,
      userId: params.userId,
      orderId: params.orderId,
      discountApplied: params.discountApplied,
      customerDiscountApplied: params.customerDiscountApplied ?? null,
      createdBy: params.actorId ?? params.userId,
      updatedBy: params.actorId ?? params.userId,
      deletedBy: null,
    },
    { transaction: params.transaction },
  );

  await Coupon.increment('usedCount', {
    by: 1,
    where: { id: params.couponId },
    transaction: params.transaction,
  });

  return { created: true };
}

export async function recordCouponUsagesForOrder(params: {
  coupons: Array<{ id: string }>;
  breakdown: AppliedCouponBreakdownEntry[];
  discountTotal: number;
  userId: string;
  orderId: string;
  actorId: string;
  transaction?: Transaction;
}): Promise<void> {
  const fallbackEqualShare =
    params.coupons.length > 0 ? params.discountTotal / params.coupons.length : 0;
  for (const coupon of params.coupons) {
    await recordCouponUsage({
      couponId: coupon.id,
      userId: params.userId,
      orderId: params.orderId,
      discountApplied: discountAppliedFromBreakdown(
        coupon.id,
        params.breakdown,
        fallbackEqualShare,
      ),
      customerDiscountApplied:
        params.breakdown.find((entry) => entry.couponId === coupon.id)?.customerDiscountApplied ?? null,
      actorId: params.actorId,
      transaction: params.transaction,
    });
  }
}

export async function destroyCouponUsageForOrder(
  orderId: string,
  transaction?: Transaction,
): Promise<void> {
  const usages = await CouponUsage.findAll({ where: { orderId }, transaction });
  for (const usage of usages) {
    await Coupon.decrement('usedCount', {
      by: 1,
      where: { id: usage.couponId },
      transaction,
    });
    await usage.destroy({ transaction });
  }
}

/**
 * A vendor's part was cancelled and none of their parts remain: give back the use of that
 * vendor's own coupons. Platform coupons return only when the whole order is cancelled.
 */
export async function destroyCouponUsageForVendorPart(
  orderId: string,
  vendorId: string,
  transaction?: Transaction,
): Promise<void> {
  const coupons = await Coupon.findAll({ where: { vendorId }, attributes: ['id'], transaction });
  if (coupons.length === 0) return;
  const usages = await CouponUsage.findAll({
    where: { orderId, couponId: coupons.map((coupon) => coupon.id) },
    transaction,
  });
  for (const usage of usages) {
    await Coupon.decrement('usedCount', { by: 1, where: { id: usage.couponId }, transaction });
    await usage.destroy({ transaction });
  }
}

/** The coupons used on an order, for its page. Includes returned uses: a cancelled order still shows them. */
export async function appliedCouponsForOrder(
  orderId: string,
): Promise<Array<{ code: string; name: string; type: string; discount: number; cashback: boolean }>> {
  const usages = await CouponUsage.findAll({ where: { orderId }, paranoid: false });
  if (usages.length === 0) return [];
  const coupons = await Coupon.findAll({ where: { id: usages.map((usage) => usage.couponId) }, paranoid: false });
  return usages.flatMap((usage) => {
    const coupon = coupons.find((row) => row.id === usage.couponId);
    if (!coupon) return [];
    return [
      {
        code: coupon.code,
        name: customerCouponName(coupon),
        type: coupon.type,
        discount: Number(usage.customerDiscountApplied ?? usage.discountApplied ?? 0),
        cashback: coupon.type === 'CASHBACK',
      },
    ];
  });
}

/**
 * A checkout that never got paid, or an order the customer cancelled: put its coupons back
 * with its items, so ordering again costs what it did. Anything the customer chose since
 * stays. A coupon that has stopped working shows on the cart as not applied. Returns the
 * codes put back.
 */
export async function restoreOrderCouponsToCart(
  order: { appliedCouponIds?: string[] | null; couponId?: string | null },
  userId: string,
  transaction: Transaction,
): Promise<string[]> {
  const ids = [...new Set([...(order.appliedCouponIds ?? []), order.couponId].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];
  const cart = await Cart.findOne({ where: { userId }, transaction });
  if (!cart || cart.couponCode || (cart.couponCodes?.length ?? 0) > 0) return [];
  const coupons = await Coupon.findAll({ where: { id: ids }, attributes: ['code', 'vendorId'], transaction });
  if (coupons.length === 0) return [];
  const primary = coupons.find((coupon) => !coupon.vendorId) ?? coupons[0]!;
  await cart.update(
    { couponCode: primary.code, couponCodes: coupons.map((coupon) => coupon.code) },
    { transaction },
  );
  return coupons.map((coupon) => coupon.code);
}
