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
  type DiscountBearer,
} from '@core/constants/statuses';
import { toPaise, fromPaise } from '@modules/pricing/money';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';

/**
 * Credits pending cashback once per order (idempotent via cashbackCreditedAt).
 * VENDOR-borne cashback writes a SETTLED CommissionLedger CashbackCost adjustment.
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
    );

    const bearer = (order.cashbackDiscountBearer as DiscountBearer | null) ?? DISCOUNT_BEARER.PLATFORM;
    if (bearer === DISCOUNT_BEARER.VENDOR && delivered.vendorId) {
      const amountPaise = toPaise(pending);
      await CommissionLedger.create(
        {
          vendorId: delivered.vendorId,
          subOrderId: delivered.id,
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
 * Claw back credited cashback on return (capped wallet recovery + full vendor reversal).
 */
export async function clawbackCashbackForReturn(input: {
  order: Order;
  returnRequestId: string;
  actorId: string;
  transaction: Transaction;
}): Promise<void> {
  const { order, returnRequestId, actorId, transaction } = input;
  if (!order.cashbackCreditedAt) return;
  const pending = Number(order.pendingCashbackAmount ?? 0);
  if (pending <= 0) return;

  const bearer = (order.cashbackDiscountBearer as DiscountBearer | null) ?? DISCOUNT_BEARER.PLATFORM;

  await walletService.clawback(
    order.userId,
    pending,
    { type: WALLET_REFERENCE_TYPE.CLAWBACK, id: returnRequestId },
    WALLET_DESCRIPTIONS.CASHBACK_CLAWBACK,
    bearer,
    transaction,
  );

  if (bearer === DISCOUNT_BEARER.VENDOR) {
    const costRow = await CommissionLedger.findOne({
      where: {
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
        subOrderId: {
          [Op.in]: (
            await SubOrder.findAll({
              where: { orderId: order.id },
              attributes: ['id'],
              transaction,
            })
          ).map((s) => s.id),
        },
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

  // Prevent double clawback on subsequent returns for the same order cashback.
  await order.update(
    {
      pendingCashbackAmount: 0,
      updatedBy: actorId,
    },
    { transaction },
  );
}

export async function processPendingCashbackCredits(limit = 100): Promise<number> {
  const orders = await Order.findAll({
    where: {
      pendingCashbackAmount: { [Op.gt]: 0 },
      cashbackCreditedAt: null,
    },
    include: [
      {
        model: SubOrder,
        as: 'subOrders',
        required: true,
        where: { status: ORDER_STATUS.DELIVERED },
      },
    ],
    limit,
  });

  let credited = 0;
  for (const order of orders) {
    const ok = await creditPendingCashbackForOrder(order.id);
    if (ok) credited += 1;
  }
  return credited;
}

export { fromPaise };
