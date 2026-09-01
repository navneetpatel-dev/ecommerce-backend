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
import { toPaise, fromPaise } from '@modules/pricing/money';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import { env } from '@config/env';

/**
 * Credits pending cashback once per order (idempotent via cashbackCreditedAt).
 * VENDOR-borne cashback writes a SETTLED CommissionLedger CashbackCost adjustment
 * against the coupon's vendor (Order.cashbackVendorId), never mutating the original commission row.
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

    const delivered = await SubOrder.findOne({
      where: { orderId: order.id, status: ORDER_STATUS.DELIVERED },
      transaction,
    });
    if (!delivered) return false;

    await walletService.credit(
      order.userId,
      pending,
      { type: WALLET_REFERENCE_TYPE.CASHBACK, id: order.id },
      `${WALLET_DESCRIPTIONS.CASHBACK_CREDIT} #${order.id.slice(0, 8).toUpperCase()}`,
      transaction,
      { pointSource: WALLET_POINT_SOURCE.PROMOTIONAL },
    );

    const bearer = (order.cashbackDiscountBearer as DiscountBearer | null) ?? DISCOUNT_BEARER.PLATFORM;
    if (bearer === DISCOUNT_BEARER.VENDOR) {
      const vendorId = order.cashbackVendorId ?? delivered.vendorId;
      const subOrder =
        vendorId && delivered.vendorId === vendorId
          ? delivered
          : vendorId
            ? (await SubOrder.findOne({
                where: { orderId: order.id, vendorId },
                transaction,
              })) ?? delivered
            : delivered;
      if (vendorId && subOrder) {
        const amountPaise = toPaise(pending);
        await CommissionLedger.create(
          {
            vendorId,
            subOrderId: subOrder.id,
            saleAmount: 0,
            commissionRate: 0,
            commissionAmount: -pending,
            taxableAmount: 0,
            discountAmount: 0,
            discountBearer: DISCOUNT_BEARER.VENDOR,
            taxAmount: 0,
            tcsAmount: 0,
            netPayoutAmount: -pending,
            shippingCollected: 0,
            saleAmountPaise: 0,
            commissionAmountPaise: -amountPaise,
            taxableAmountPaise: 0,
            discountAmountPaise: 0,
            taxAmountPaise: 0,
            tcsAmountPaise: 0,
            netPayoutAmountPaise: -amountPaise,
            shippingCollectedPaise: 0,
            referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
            status: COMMISSION_STATUS.SETTLED,
            createdBy: order.userId,
            updatedBy: order.userId,
            deletedBy: null,
          },
          { transaction },
        );
      }
    }

    await order.update(
      {
        cashbackCreditedAt: new Date(),
        updatedBy: order.userId,
      },
      { transaction },
    );
    return true;
  };

  if (outerTransaction) return run(outerTransaction);
  return sequelize.transaction(run);
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
        const amount = Math.abs(Number(costRow.commissionAmount));
        const amountPaise = Math.abs(Number(costRow.commissionAmountPaise ?? toPaise(amount)));
        await CommissionLedger.create(
          {
            vendorId: costRow.vendorId,
            subOrderId: costRow.subOrderId,
            saleAmount: 0,
            commissionRate: 0,
            commissionAmount: amount,
            taxableAmount: 0,
            discountAmount: 0,
            discountBearer: DISCOUNT_BEARER.VENDOR,
            taxAmount: 0,
            tcsAmount: 0,
            netPayoutAmount: amount,
            shippingCollected: 0,
            saleAmountPaise: 0,
            commissionAmountPaise: amountPaise,
            taxableAmountPaise: 0,
            discountAmountPaise: 0,
            taxAmountPaise: 0,
            tcsAmountPaise: 0,
            netPayoutAmountPaise: amountPaise,
            shippingCollectedPaise: 0,
            referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL,
            status: COMMISSION_STATUS.SETTLED,
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
