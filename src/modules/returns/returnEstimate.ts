import { z } from 'zod';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ORDER_STATUS, RETURN_REASON, RETURN_REASON_VALUES } from '@core/constants/statuses';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { Order } from '@database/models/order.model';
import { Coupon } from '@database/models/coupon.model';
import { fromPaise } from '@modules/pricing/money';
import { frozenPaise } from '@modules/pricing/frozenMoneySql';
import { customerCouponName } from '@modules/coupons/coupon.utils';
import { estimateCashbackClawbackPaise } from '@modules/wallet/cashbackBreakdown';
import { computeOfferHoldBack } from './returnOfferAdjustment';
import { reverseReturnLine } from './returnReversal';

export const ReturnEstimateQuerySchema = z.object({
  orderItemId: z.string().uuid(),
  returnQuantity: z.coerce.number().int().positive().optional(),
  /** The fee for some reasons ("changed mind") depends on it; any reason without a fee by default. */
  reasonCode: z.enum(RETURN_REASON_VALUES).optional(),
});

export type ReturnEstimateQuery = z.infer<typeof ReturnEstimateQuerySchema>;

export type ReturnEstimate = {
  /** What the customer would get back (rupees). */
  refund: number;
  /** Less, because the items kept would no longer qualify for an offer (rupees). */
  offerAdjustment: number;
  /** The offers the kept items would lose. */
  offerNames: string[];
  /** Cashback from this order that would be taken back from the wallet (rupees). */
  cashbackClawback: number;
  /** Return shipping fee taken off (rupees). */
  returnShippingFee: number;
};

/**
 * What a return would refund, worked out exactly as approval will, before it's asked for:
 * so a customer returning one of two BOGO units sees it brings back nothing, rather than
 * finding out after the item is collected. Reads only; nothing is reserved or written.
 */
export async function estimateReturnRefund(userId: string, query: ReturnEstimateQuery): Promise<ReturnEstimate> {
  const orderItem = await OrderItem.findByPk(query.orderItemId, {
    include: [{ model: SubOrder, as: 'subOrder', include: [{ model: Order, as: 'order' }] }],
  });
  if (!orderItem) throw new NotFoundError('OrderItem');
  const item = orderItem as OrderItem & { subOrder: SubOrder & { order: Order } };
  if (item.subOrder.order.userId !== userId) throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
  if (item.subOrder.status !== ORDER_STATUS.DELIVERED) throw new ForbiddenError(ERROR_MESSAGES.ITEM_MUST_BE_DELIVERED);

  const { reversal, returnQty } = await reverseReturnLine({
    orderItem: item,
    returnId: null,
    requestedQuantity: query.returnQuantity,
    reasonCode: query.reasonCode ?? RETURN_REASON.DAMAGED,
  });
  const order = item.subOrder.order;
  const hold = await computeOfferHoldBack({
    order,
    returnId: null,
    variantId: item.variantId,
    returnQuantity: returnQty,
    refundPaise: reversal.customerRefundPaise,
  });
  const coupons = hold.couponIds.length
    ? await Coupon.findAll({ where: { id: hold.couponIds }, attributes: ['code', 'type', 'value'] })
    : [];
  const clawbackPaise = estimateCashbackClawbackPaise(order, {
    variantId: item.variantId,
    returnQuantity: returnQty,
    refundMerchandisePaise: reversal.refundMerchandisePaise,
    orderMerchandiseBeforePaise: frozenPaise(item.subOrder.taxableAmountPaise),
  });
  return {
    refund: fromPaise(Math.max(0, reversal.customerRefundPaise - hold.heldBackPaise)),
    offerAdjustment: fromPaise(Math.max(0, hold.heldBackPaise)),
    offerNames: coupons.map((coupon) => customerCouponName(coupon)),
    cashbackClawback: fromPaise(clawbackPaise),
    returnShippingFee: fromPaise(reversal.returnShippingFeePaise),
  };
}
