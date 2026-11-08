import { Op, type Transaction } from 'sequelize';
import { ReturnRequest } from '@database/models/returnRequest.model';
import type { OrderItem } from '@database/models/orderItem.model';
import type { SubOrder } from '@database/models/subOrder.model';
import { Vendor } from '@database/models/vendor.model';
import { RETURN_STATUS, type ReturnReason } from '@core/constants/statuses';
import { toPaise } from '@modules/pricing/money';
import { frozenPaise } from '@modules/pricing/frozenMoneySql';
import { pricingService } from '@modules/pricing/pricing.service';
import { settingsService } from '@modules/settings/settings.service';

/** The return shipping fee in paise: the vendor's own, else the platform's. */
export async function resolveReturnShippingFeePaise(vendorId: string | null | undefined): Promise<number> {
  const settings = await settingsService.getPlatformSettings();
  let fee = Number(settings.returnShippingFee ?? 0);
  if (vendorId) {
    const vendor = await Vendor.findByPk(vendorId);
    if (vendor?.returnShippingFee != null && Number.isFinite(Number(vendor.returnShippingFee))) {
      fee = Number(vendor.returnShippingFee);
    }
  }
  return toPaise(fee);
}

/**
 * What returning `requestedQuantity` of this line gives back, from the money frozen on the
 * order: the same figures approval freezes, and the estimate shown before a return is asked
 * for. Takes account of this part's earlier returns (shipping already refunded, the return
 * fee charged once per parcel). Writes nothing.
 */
export async function reverseReturnLine(input: {
  orderItem: OrderItem & { subOrder: SubOrder };
  /** The return being frozen, left out of "earlier returns"; null for an estimate. */
  returnId: string | null;
  requestedQuantity: number | null | undefined;
  reasonCode: ReturnReason;
  transaction?: Transaction;
}) {
  const { orderItem } = input;
  const priorReturns = await ReturnRequest.findAll({
    where: {
      subOrderId: orderItem.subOrderId,
      ...(input.returnId ? { id: { [Op.ne]: input.returnId } } : {}),
      status: { [Op.ne]: RETURN_STATUS.REJECTED },
    },
    attributes: ['shippingRefundAmount', 'returnShippingFeeAmount'],
    transaction: input.transaction,
  });
  const shippingRefundedPaise = priorReturns.reduce(
    (sum, prior) => sum + toPaise(Number(prior.shippingRefundAmount ?? 0)),
    0,
  );
  const returnFeeAlreadyCharged = priorReturns.some(
    (prior) => toPaise(Number(prior.returnShippingFeeAmount ?? 0)) > 0,
  );
  const shippingChargedPaise = Math.max(
    0,
    frozenPaise(orderItem.subOrder.shippingCostPaise) - frozenPaise(orderItem.subOrder.shippingDiscountAmountPaise),
  );
  const returnShippingFeePaise = await resolveReturnShippingFeePaise(orderItem.subOrder.vendorId);

  const lineQty = Math.trunc(Number(orderItem.quantity)) || 0;
  const returnQty = Math.min(Math.max(1, Math.floor(Number(input.requestedQuantity ?? lineQty))), lineQty);

  const frozen = pricingService.frozenLineFromOrderItem({
    id: orderItem.id,
    quantity: Number(orderItem.quantity),
    taxBreakdown: (orderItem.taxBreakdown as any) ?? null,
    unitPricePaise: frozenPaise(orderItem.unitPricePaise),
    discountAmountPaise: frozenPaise(orderItem.discountAmountPaise),
    taxableAmountPaise: frozenPaise(orderItem.taxableAmountPaise),
    taxAmountPaise: frozenPaise(orderItem.taxAmountPaise),
    commissionAmountPaise: frozenPaise(orderItem.commissionAmountPaise),
    tcsAmountPaise: frozenPaise(orderItem.tcsAmountPaise),
    netPayoutAmountPaise: frozenPaise(orderItem.netPayoutAmountPaise),
    supplyTaxablePaise: orderItem.supplyTaxablePaise,
    supplyTaxPaise: orderItem.supplyTaxPaise,
  });
  const reversal = pricingService.reverseLineFromFrozen(frozen, returnQty, {
    reasonCode: input.reasonCode,
    shippingChargedPaise,
    returnShippingFeePaise,
    shippingRefundedPaise,
    // The part's goods still standing (reduced in place by earlier returns).
    standingTaxablePaise: frozenPaise(orderItem.subOrder.taxableAmountPaise),
    returnFeeAlreadyCharged,
  });
  return { reversal, frozen, lineQty, returnQty, isFullReturn: returnQty >= lineQty };
}
