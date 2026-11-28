import { Op, type Transaction } from 'sequelize';
import type { Order, CouponLineSnapshot } from '@database/models/order.model';
import type { Coupon } from '@database/models/coupon.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { SubOrder } from '@database/models/subOrder.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  RETURN_STATUS,
} from '@core/constants/statuses';
import { fromPaise } from '@modules/pricing/money';
import { isReversedPart } from '@modules/pricing/partReversal';
import { computeTypeDiscount, type CartLineForCoupon } from '@modules/coupons/coupon.utils';
import { toPaise } from '@modules/pricing/money';

/** Units still with the customer, per variant: placed, less refunded returns and this one. */
async function keptQuantities(
  order: Order,
  current: { variantId: string; quantity: number },
  returnId: string | null,
  transaction?: Transaction,
): Promise<{ kept: Map<string, number>; liveVendors: Set<string | null> }> {
  const parts = await SubOrder.findAll({ where: { orderId: order.id }, attributes: ['id', 'vendorId', 'status'], transaction });
  const prior = await ReturnRequest.findAll({
    where: {
      subOrderId: parts.map((part) => part.id),
      ...(returnId ? { id: { [Op.ne]: returnId } } : {}),
      status: { [Op.ne]: RETURN_STATUS.REJECTED },
      refundMerchandiseAmountPaise: { [Op.ne]: null },
    },
    include: [{ model: OrderItem, as: 'orderItem', attributes: ['variantId'] }],
    transaction,
  });
  const returned = new Map<string, number>([[current.variantId, current.quantity]]);
  for (const row of prior as Array<ReturnRequest & { orderItem?: OrderItem }>) {
    const variantId = row.orderItem?.variantId;
    if (variantId) returned.set(variantId, (returned.get(variantId) ?? 0) + Number(row.returnQuantity ?? 0));
  }
  const liveVendors = new Set(parts.filter((part) => !isReversedPart(part.status)).map((part) => part.vendorId ?? null));
  const kept = new Map<string, number>();
  for (const snapshot of order.couponLineBreakdown ?? []) {
    for (const line of snapshot.lines) {
      const live = liveVendors.has(line.vendorId ?? null);
      kept.set(line.variantId, live ? Math.max(0, line.quantity - (returned.get(line.variantId) ?? 0)) : 0);
    }
  }
  return { kept, liveVendors };
}

/** What the coupon gives the kept lines, GST incl. (paise): 0 once they no longer qualify. */
function recomputedDiscountPaise(snapshot: CouponLineSnapshot, kept: Map<string, number>): number {
  const lines: CartLineForCoupon[] = snapshot.lines
    .map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      categoryId: null,
      vendorId: line.vendorId,
      unitPrice: fromPaise(line.unitPaise),
      quantity: kept.get(line.variantId) ?? 0,
      lineAmountPaise: line.unitPaise * (kept.get(line.variantId) ?? 0),
    }))
    .filter((line) => line.quantity > 0);
  if (lines.length === 0) return 0;
  const subtotalPaise = lines.reduce((sum, line) => sum + (line.lineAmountPaise ?? 0), 0);
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (snapshot.minOrderValue != null && subtotalPaise < toPaise(snapshot.minOrderValue)) return 0;
  if (snapshot.minQuantity != null && quantity < snapshot.minQuantity) return 0;
  const { discount } = computeTypeDiscount(snapshot as unknown as Coupon, lines, 0);
  return toPaise(discount);
}

/**
 * A return that breaks (or shrinks) an offer: the items kept cost what the offer now gives
 * them, so the refund is cut by the discount they lost. Example: two BOGO units, one comes
 * back; the one kept was paid for in full, so nothing is refunded. Updates the order's
 * snapshot with what was held back, and gives a vendor-funded coupon's share to the vendor.
 * Returns the paise to hold back (never more than `refundPaise`); negative when an earlier
 * hold-back is given back. Older orders: 0.
 */
/** What a return would hold back, worked out without writing anything (also for estimates). */
export type OfferHoldBack = {
  heldBackPaise: number;
  /** The order's snapshot with this return's hold-back recorded. */
  next: CouponLineSnapshot[];
  /** Vendor-funded hold-backs, per vendor (paise). */
  vendorPaise: Map<string, number>;
  /** Coupons whose offer the kept items lost (or partly lost). */
  couponIds: string[];
};

export async function computeOfferHoldBack(input: {
  order: Order;
  /** The return being frozen; null for an estimate before it exists. */
  returnId: string | null;
  variantId: string;
  returnQuantity: number;
  refundPaise: number;
  transaction?: Transaction;
}): Promise<OfferHoldBack> {
  const snapshots = input.order.couponLineBreakdown ?? [];
  const none = { heldBackPaise: 0, next: snapshots, vendorPaise: new Map<string, number>(), couponIds: [] };
  const touched = snapshots.some((snapshot) => snapshot.lines.some((line) => line.variantId === input.variantId));
  if (!touched) return none;
  const { kept } = await keptQuantities(
    input.order,
    { variantId: input.variantId, quantity: input.returnQuantity },
    input.returnId,
    input.transaction,
  );
  let left = input.refundPaise;
  const vendorPaise = new Map<string, number>();
  const couponIds: string[] = [];
  const next = snapshots.map((snapshot) => {
    const keptShare = snapshot.lines.reduce(
      (sum, line) => sum + (line.quantity > 0 ? (line.discountPaise * (kept.get(line.variantId) ?? 0)) / line.quantity : 0),
      0,
    );
    // What the kept items owe in all, less what earlier returns already held back. It can
    // fall: once more comes back, the offer may fit again and part of it is returned.
    const owed = Math.max(0, Math.round(keptShare) - recomputedDiscountPaise(snapshot, kept));
    const delta = owed - snapshot.takenPaise;
    const applied = delta > 0 ? Math.min(delta, left) : delta;
    left -= applied;
    if (applied > 0) couponIds.push(snapshot.couponId);
    if (applied !== 0 && snapshot.vendorId) {
      vendorPaise.set(snapshot.vendorId, (vendorPaise.get(snapshot.vendorId) ?? 0) + applied);
    }
    return { ...snapshot, takenPaise: snapshot.takenPaise + applied };
  });
  return { heldBackPaise: input.refundPaise - left, next, vendorPaise, couponIds };
}

export async function holdBackForBrokenOffers(input: {
  order: Order;
  returnId: string;
  variantId: string;
  returnQuantity: number;
  refundPaise: number;
  subOrderId: string;
  actorId: string;
  transaction: Transaction;
}): Promise<number> {
  const { heldBackPaise: heldBack, next, vendorPaise } = await computeOfferHoldBack(input);
  if (heldBack === 0) return 0;
  await input.order.update({ couponLineBreakdown: next }, { transaction: input.transaction });
  for (const [vendorId, paise] of vendorPaise) {
    const part = await SubOrder.findOne({ where: { orderId: input.order.id, vendorId }, transaction: input.transaction });
    if (!part) continue;
    await CommissionLedger.create(
      {
        vendorId,
        subOrderId: part.id,
        commissionRate: 0,
        discountBearer: DISCOUNT_BEARER.VENDOR,
        saleAmountPaise: 0,
        commissionAmountPaise: 0,
        taxableAmountPaise: 0,
        discountAmountPaise: 0,
        taxAmountPaise: 0,
        tcsAmountPaise: 0,
        netPayoutAmountPaise: paise,
        shippingCollectedPaise: 0,
        referenceType: COMMISSION_REFERENCE_TYPE.OFFER_ADJUSTMENT,
        status: COMMISSION_STATUS.PENDING,
        createdBy: input.actorId,
        updatedBy: input.actorId,
        deletedBy: null,
      },
      { transaction: input.transaction },
    );
  }
  return heldBack;
}
