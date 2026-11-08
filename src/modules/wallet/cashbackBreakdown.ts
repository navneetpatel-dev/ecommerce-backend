import type { Transaction } from 'sequelize';
import { Op } from 'sequelize';
import type { CashbackBreakdownEntry, Order } from '@database/models/order.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { SubOrder } from '@database/models/subOrder.model';
import {
  COMMISSION_REFERENCE_TYPE,
  COMMISSION_STATUS,
  DISCOUNT_BEARER,
  WALLET_POINT_SOURCE,
  WALLET_REFERENCE_TYPE,
  type DiscountBearer,
} from '@core/constants/statuses';
import { fromPaise, toPaise } from '@modules/pricing/money';
import { walletService } from '@modules/wallet/wallet.service';
import { WALLET_DESCRIPTIONS } from '@modules/wallet/wallet.constants';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { OrderItem } from '@database/models/orderItem.model';
import { RETURN_STATUS } from '@core/constants/statuses';
import { isReversedPart } from '@modules/pricing/partReversal';

/** A vendor's adjustment row on their own part: a cashback cost (negative) or its reversal. */
export function cashbackLedgerRow(input: {
  vendorId: string;
  subOrderId: string;
  amountPaise: number;
  referenceType: string;
  actorId: string;
}) {
  return {
    vendorId: input.vendorId,
    subOrderId: input.subOrderId,
    commissionRate: 0,
    discountBearer: DISCOUNT_BEARER.VENDOR,
    saleAmountPaise: 0,
    commissionAmountPaise: input.amountPaise,
    taxableAmountPaise: 0,
    discountAmountPaise: 0,
    taxAmountPaise: 0,
    tcsAmountPaise: 0,
    netPayoutAmountPaise: input.amountPaise,
    shippingCollectedPaise: 0,
    referenceType: input.referenceType,
    // Pending, so the next payout run settles it.
    status: COMMISSION_STATUS.PENDING,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    deletedBy: null,
  };
}

/** Refunded returns per variant on these parts: goods the customer did not keep. */
async function returnedQuantityByVariant(
  subOrderIds: string[],
  transaction: Transaction,
): Promise<Map<string, number>> {
  const returned = new Map<string, number>();
  if (subOrderIds.length === 0) return returned;
  const rows = await ReturnRequest.findAll({
    where: {
      subOrderId: subOrderIds,
      status: { [Op.ne]: RETURN_STATUS.REJECTED },
      refundMerchandiseAmountPaise: { [Op.ne]: null },
    },
    include: [{ model: OrderItem, as: 'orderItem', attributes: ['variantId'] }],
    transaction,
  });
  for (const row of rows as Array<ReturnRequest & { orderItem?: OrderItem }>) {
    const variantId = row.orderItem?.variantId;
    if (variantId) returned.set(variantId, (returned.get(variantId) ?? 0) + Number(row.returnQuantity ?? 0));
  }
  return returned;
}

/**
 * What each cashback coupon has earned, in paise: its amount in proportion to its own lines
 * the customer kept. A cancelled part earns nothing, and one vendor's cancellation doesn't
 * touch another vendor's coupon.
 */
export async function earnedCashbackPaise(
  entries: CashbackBreakdownEntry[],
  subOrders: SubOrder[],
  transaction: Transaction,
): Promise<number[]> {
  const returned = await returnedQuantityByVariant(subOrders.map((part) => part.id), transaction);
  const liveVendors = new Set(
    subOrders.filter((part) => !isReversedPart(part.status)).map((part) => part.vendorId ?? null),
  );
  return entries.map((entry) => {
    const total = entry.lines.reduce((sum, line) => sum + line.basePaise, 0);
    if (total <= 0) return 0;
    const kept = entry.lines.reduce((sum, line) => {
      if (!liveVendors.has(line.vendorId ?? null) || line.quantity <= 0) return sum;
      const keptQuantity = Math.max(0, line.quantity - (returned.get(line.variantId) ?? 0));
      return sum + (line.basePaise * keptQuantity) / line.quantity;
    }, 0);
    return Math.round((entry.amountPaise * kept) / total);
  });
}

/** What returning these units takes back from one coupon, never more than it paid out. */
export function clawbackForReturnPaise(
  entry: CashbackBreakdownEntry,
  variantId: string,
  returnQuantity: number,
): number {
  const line = entry.lines.find((row) => row.variantId === variantId);
  const total = entry.lines.reduce((sum, row) => sum + row.basePaise, 0);
  if (!line || total <= 0 || line.quantity <= 0) return 0;
  const returnedBase = (line.basePaise * Math.min(returnQuantity, line.quantity)) / line.quantity;
  return Math.min(entry.creditedPaise ?? 0, Math.round((entry.amountPaise * returnedBase) / total));
}

/** Credit an order's cashback coupon by coupon: one wallet credit, each vendor charged their own. */
export async function creditCashbackBreakdown(
  order: Order,
  allSubOrders: SubOrder[],
  liveParts: SubOrder[],
  transaction: Transaction,
): Promise<boolean> {
  const entries = order.cashbackBreakdown ?? [];
  const earned = await earnedCashbackPaise(entries, allSubOrders, transaction);
  const totalPaise = earned.reduce((sum, paise) => sum + paise, 0);
  await order.update(
    {
      cashbackCreditedAt: new Date(),
      pendingCashbackAmount: fromPaise(totalPaise),
      cashbackBreakdown: entries.map((entry, index) => ({ ...entry, creditedPaise: earned[index] ?? 0 })),
      updatedBy: order.userId,
    },
    { transaction },
  );
  if (totalPaise <= 0) return true;
  await walletService.credit(
    order.userId,
    fromPaise(totalPaise),
    { type: WALLET_REFERENCE_TYPE.CASHBACK, id: order.id },
    `${WALLET_DESCRIPTIONS.CASHBACK_CREDIT} #${order.id.slice(0, 8)}`,
    transaction,
    { pointSource: WALLET_POINT_SOURCE.PROMOTIONAL },
  );
  for (const [index, entry] of entries.entries()) {
    const paise = earned[index] ?? 0;
    if (paise <= 0 || entry.bearer !== DISCOUNT_BEARER.VENDOR || !entry.vendorId) continue;
    const part = liveParts.find((row) => row.vendorId === entry.vendorId);
    if (!part) continue;
    await CommissionLedger.create(
      cashbackLedgerRow({
        vendorId: entry.vendorId,
        subOrderId: part.id,
        amountPaise: -paise,
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST,
        actorId: order.userId,
      }),
      { transaction },
    );
  }
  return true;
}

/** Take back the returned goods' share from the coupons earned on them, and from their funders' cost. */
export async function clawbackCashbackBreakdown(input: {
  order: Order;
  returnRequestId: string;
  actorId: string;
  transaction: Transaction;
  variantId: string;
  returnQuantity: number;
}): Promise<void> {
  const { order, returnRequestId, actorId, transaction, variantId, returnQuantity } = input;
  const parts = await SubOrder.findAll({
    where: { orderId: order.id },
    attributes: ['id', 'vendorId'],
    transaction,
  });
  const claws = (order.cashbackBreakdown ?? []).map((entry) => ({
    entry,
    clawPaise: clawbackForReturnPaise(entry, variantId, returnQuantity),
  }));
  const byBearer = new Map<DiscountBearer, number>();
  for (const { entry, clawPaise } of claws) {
    if (clawPaise > 0) byBearer.set(entry.bearer, (byBearer.get(entry.bearer) ?? 0) + clawPaise);
  }
  for (const [bearer, paise] of byBearer) {
    await walletService.clawback(
      order.userId,
      fromPaise(paise),
      { type: WALLET_REFERENCE_TYPE.CLAWBACK, id: returnRequestId },
      WALLET_DESCRIPTIONS.CASHBACK_CLAWBACK,
      bearer,
      transaction,
    );
  }
  for (const { entry, clawPaise } of claws) {
    const part = parts.find((row) => row.vendorId === entry.vendorId);
    if (clawPaise <= 0 || entry.bearer !== DISCOUNT_BEARER.VENDOR || !entry.vendorId || !part) continue;
    await CommissionLedger.create(
      cashbackLedgerRow({
        vendorId: entry.vendorId,
        subOrderId: part.id,
        amountPaise: clawPaise,
        referenceType: COMMISSION_REFERENCE_TYPE.CASHBACK_COST_REVERSAL,
        actorId,
      }),
      { transaction },
    );
  }
  const remaining = claws.map(({ entry, clawPaise }) => ({
    ...entry,
    creditedPaise: Math.max(0, (entry.creditedPaise ?? 0) - clawPaise),
  }));
  await order.update(
    {
      cashbackBreakdown: remaining,
      pendingCashbackAmount: fromPaise(remaining.reduce((sum, entry) => sum + (entry.creditedPaise ?? 0), 0)),
      updatedBy: actorId,
    },
    { transaction },
  );
}

/**
 * Cashback a return would take back from the wallet (paise), worked out without writing
 * anything, for the estimate shown before a return is requested. Nothing is taken back
 * while the cashback hasn't been credited yet (the order then just earns less).
 */
export function estimateCashbackClawbackPaise(
  order: Pick<Order, 'cashbackCreditedAt' | 'cashbackBreakdown' | 'pendingCashbackAmount'>,
  input: { variantId: string; returnQuantity: number; refundMerchandisePaise: number; orderMerchandiseBeforePaise: number },
): number {
  if (!order.cashbackCreditedAt) return 0;
  if (order.cashbackBreakdown?.length) {
    return order.cashbackBreakdown.reduce(
      (sum, entry) => sum + clawbackForReturnPaise(entry, input.variantId, input.returnQuantity),
      0,
    );
  }
  // Older orders: the same share of the cashback as of the merchandise coming back.
  const ratio = Math.min(1, Math.max(0, input.refundMerchandisePaise / Math.max(1, input.orderMerchandiseBeforePaise)));
  return Math.round(toPaise(Number(order.pendingCashbackAmount ?? 0)) * ratio);
}
