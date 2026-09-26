import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import { sequelize } from '@database/models';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  ORDER_STATUS,
  WALLET_REFERENCE_TYPE,
  WALLET_POINT_SOURCE,
  type DiscountBearer,
} from '@core/constants/statuses';
import { fromPaise, roundMoney, sumRupees, toPaise } from '@modules/pricing/money';
import { frozenPaise } from '@modules/pricing/frozenMoneySql';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import { env } from '@config/env';

/**
 * Credits pending cashback once per order (idempotent via cashbackCreditedAt).
 * VENDOR-borne cashback writes a PENDING CommissionLedger CashbackCost adjustment
 * against the coupon's vendor (Order.cashbackVendorId), never mutating the original commission
 * row. The next payout run deducts it from that vendor's payout.
 */
export async function creditPendingCashbackForOrder(
  orderId: string,
  outerTransaction?: Transaction,
): Promise<boolean> {
  const run = async (transaction: Transaction) => {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) return false;
    const pending = Number(order.pendingCashbackAmount ?? 0);
    if (pending <= 0 || order.cashbackCreditedAt) return false;

    // `pendingCashbackAmount` covers every vendor in the cart, not just one — crediting it the
    // moment a single suborder delivers would pay out cashback for items from other vendors that
    // haven't shipped yet (and may still be cancelled). Require every suborder that hasn't been
    // cancelled to be DELIVERED before crediting anything.
    const allSubOrders = await SubOrder.findAll({
      where: { orderId: order.id },
      transaction,
    });
    const relevant = allSubOrders.filter((s) => s.status !== ORDER_STATUS.CANCELLED);
    if (relevant.length === 0) return false;
    const allDelivered = relevant.every((s) => s.status === ORDER_STATUS.DELIVERED);
    if (!allDelivered) return false;
    const delivered = relevant[0]!;

    // `pending` is frozen at its checkout-time (whole-cart) value — it is never shrunk when a
    // sibling suborder is cancelled (see suborders.service.ts's cancellation branch). Prorate it
    // here, fresh, against the immutable `merchandiseSubtotal`/`subtotal` figures rather than
    // mutating a running balance incrementally: computing it fresh each time is unaffected by how
    // many suborders were cancelled or in what order, whereas an incremental "shrink by this
    // suborder's share" on every cancellation compounds against an already-shrunk balance and
    // under-reduces it after two or more partial cancellations.
    const merchandiseBase = Number(order.merchandiseSubtotal ?? 0);
    const deliveredMerchandise = sumRupees(relevant.map((s) => s.subtotal));
    const proratedPending =
      merchandiseBase > 0
        ? roundMoney(pending * Math.min(1, deliveredMerchandise / merchandiseBase))
        : pending;

    // Overwrite pendingCashbackAmount with what was ACTUALLY credited (proratedPending, which can
    // be less than the frozen checkout-time value once a sibling suborder was cancelled) — after
    // this point the column means "cashback actually in the customer's wallet for this order",
    // which is exactly what clawbackCashbackForReturn's proportional-clawback math reads. Leaving
    // it at the pre-proration value would let a later return's clawback calculation claw back
    // more than was ever credited.
    await order.update(
      {
        cashbackCreditedAt: new Date(),
        pendingCashbackAmount: proratedPending,
        updatedBy: order.userId,
      },
      { transaction },
    );

    if (proratedPending <= 0) return true;

    await walletService.credit(
      order.userId,
      proratedPending,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: order.id },
      `${WALLET_DESCRIPTIONS.CASHBACK_CREDIT} #${order.id.slice(0, 8).toUpperCase()}`,
      transaction,
      {
        pointSource: WALLET_POINT_SOURCE.PROMOTIONAL,
      },
    );

    const bearer = (order.cashbackDiscountBearer as DiscountBearer | null) ?? DISCOUNT_BEARER.PLATFORM;
    if (bearer === DISCOUNT_BEARER.VENDOR) {
      const vendorId = order.cashbackVendorId ?? delivered.vendorId;
      // A delivered sub-order of that vendor, never a cancelled one: the payout run only
      // picks up ledgers on delivered sub-orders, so a cost on a cancelled one would
      // never be deducted.
      const subOrder = relevant.find((s) => s.vendorId === vendorId) ?? delivered;
      if (vendorId && subOrder) {
        const amountPaise = toPaise(proratedPending);
        await CommissionLedger.create(
          {
            vendorId,
            subOrderId: subOrder.id,
            commissionRate: 0,
            discountBearer: DISCOUNT_BEARER.VENDOR,
            saleAmountPaise: 0,
            commissionAmountPaise: -amountPaise,
            taxableAmountPaise: 0,
            discountAmountPaise: 0,
            taxAmountPaise: 0,
            tcsAmountPaise: 0,
            netPayoutAmountPaise: -amountPaise,
            shippingCollectedPaise: 0,
            referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
            // Pending, so the next payout run deducts it from the vendor's payout.
            status: COMMISSION_STATUS.PENDING,
            createdBy: order.userId,
            updatedBy: order.userId,
            deletedBy: null,
          },
          { transaction },
        );
      }
    }

    return true;
  };

  if (outerTransaction) return run(outerTransaction);
  return sequelize.transaction(run);
}

/**
 * Shrink cashback that is still pending (not yet credited) when a return removes
 * merchandise from the order, by the share of merchandise returned.
 *
 * `creditPendingCashbackForOrder` prorates against the order's merchandise subtotal,
 * which a return rewrites to what is left — so on its own it would pay full cashback
 * on returned items. Scaling pending by after/before here keeps the credit exact:
 * pending × (after ÷ before) × (delivered ÷ after) = pending × delivered ÷ before.
 * Once cashback is credited, `clawbackCashbackForReturn` handles returns instead.
 */
export async function shrinkPendingCashbackForReturn(input: {
  order: Order;
  actorId: string;
  transaction: Transaction;
  /** Order merchandise subtotal (all sub-orders), in paise, before and after this return. */
  merchandiseBeforePaise: number;
  merchandiseAfterPaise: number;
}): Promise<void> {
  const { order, actorId, transaction, merchandiseBeforePaise, merchandiseAfterPaise } = input;
  if (order.cashbackCreditedAt) return;
  const pendingPaise = toPaise(Number(order.pendingCashbackAmount ?? 0));
  if (pendingPaise <= 0 || merchandiseBeforePaise <= 0) return;
  const keptPaise = Math.max(0, Math.min(merchandiseAfterPaise, merchandiseBeforePaise));
  const nextPaise = Math.round((pendingPaise * keptPaise) / merchandiseBeforePaise);
  if (nextPaise === pendingPaise) return;
  await order.update(
    { pendingCashbackAmount: fromPaise(nextPaise), updatedBy: actorId },
    { transaction },
  );
}

/**
 * Claw back credited cashback proportionally to returned merchandise.
 * Vendor CashbackCost is reversed in FULL on first clawback after credit
 * (vendor does not bear write-off risk from partial wallet recovery).
 */
export async function clawbackCashbackForReturn(input: {
  order: Order;
  returnRequestId: string;
  actorId: string;
  transaction: Transaction;
  /** Merchandise (taxable) paise being refunded on this return. */
  refundMerchandisePaise: number;
  /** Order merchandise taxable paise still on the books before this return was frozen. */
  orderMerchandiseBeforePaise: number;
}): Promise<void> {
  const {
    order,
    returnRequestId,
    actorId,
    transaction,
    refundMerchandisePaise,
    orderMerchandiseBeforePaise,
  } = input;
  if (!order.cashbackCreditedAt) return;
  const remainingCashback = Number(order.pendingCashbackAmount ?? 0);
  if (remainingCashback <= 0) return;

  const denom = Math.max(1, orderMerchandiseBeforePaise);
  const ratio = Math.min(1, Math.max(0, refundMerchandisePaise / denom));
  const clawAmount = fromPaise(Math.round(toPaise(remainingCashback) * ratio));
  if (clawAmount <= 0) return;

  const bearer = (order.cashbackDiscountBearer as DiscountBearer | null) ?? DISCOUNT_BEARER.PLATFORM;
  const isFullClawback = clawAmount >= remainingCashback - 0.001;

  await walletService.clawback(
    order.userId,
    clawAmount,
    { type: WALLET_REFERENCE_TYPE.CLAWBACK, id: returnRequestId },
    WALLET_DESCRIPTIONS.CASHBACK_CLAWBACK,
    bearer,
    transaction,
  );

  // Reverse vendor CashbackCost in FULL once (first clawback after credit), regardless of recovery.
  if (bearer === DISCOUNT_BEARER.VENDOR) {
    const subIds = (
      await SubOrder.findAll({
        where: { orderId: order.id },
        attributes: ['id'],
        transaction,
      })
    ).map((s) => s.id);

    const alreadyReversed = await CommissionLedger.findOne({
      where: {
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL,
        subOrderId: { [Op.in]: subIds },
      },
      transaction,
    });

    if (!alreadyReversed) {
      const costRow = await CommissionLedger.findOne({
        where: {
          referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
          subOrderId: { [Op.in]: subIds },
        },
        transaction,
      });
      if (costRow) {
        const amountPaise = Math.abs(frozenPaise(costRow.commissionAmountPaise));
        await CommissionLedger.create(
          {
            vendorId: costRow.vendorId,
            subOrderId: costRow.subOrderId,
            commissionRate: 0,
            discountBearer: DISCOUNT_BEARER.VENDOR,
            saleAmountPaise: 0,
            commissionAmountPaise: amountPaise,
            taxableAmountPaise: 0,
            discountAmountPaise: 0,
            taxAmountPaise: 0,
            tcsAmountPaise: 0,
            netPayoutAmountPaise: amountPaise,
            shippingCollectedPaise: 0,
            referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL,
            // Pending, so the next payout run pays it back (or nets it against a cost
            // that has not been deducted yet).
            status: COMMISSION_STATUS.PENDING,
            createdBy: actorId,
            updatedBy: actorId,
            deletedBy: null,
          },
          { transaction },
        );
      }
    }
  }

  const nextPending = isFullClawback
    ? 0
    : Math.round((remainingCashback - clawAmount) * 100) / 100;
  await order.update(
    {
      pendingCashbackAmount: Math.max(0, nextPending),
      updatedBy: actorId,
    },
    { transaction },
  );
}

/**
 * Delayed-job pattern matching REVIEW_REQUEST: credit cashback for orders whose
 * delivered sub-order fell into the delay window.
 */
export async function processPendingCashbackCredits(limit = 100): Promise<number> {
  const delayMs = env.CASHBACK_CREDIT_DELAY_DAYS * 24 * 60 * 60 * 1000;
  const windowEnd = new Date(Date.now() - delayMs);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const deliveredSubs = await SubOrder.findAll({
    where: {
      status: ORDER_STATUS.DELIVERED,
      updatedAt: { [Op.between]: [windowStart, windowEnd] },
    },
    attributes: ['orderId'],
    limit,
  });
  const orderIds = [...new Set(deliveredSubs.map((s) => s.orderId))];
  if (orderIds.length === 0) return 0;

  const orders = await Order.findAll({
    where: {
      id: { [Op.in]: orderIds },
      pendingCashbackAmount: { [Op.gt]: 0 },
      cashbackCreditedAt: null,
    },
  });

  let credited = 0;
  for (const order of orders) {
    const ok = await creditPendingCashbackForOrder(order.id);
    if (ok) credited += 1;
  }
  return credited;
}

export { fromPaise };
