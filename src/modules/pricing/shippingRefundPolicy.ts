import { RETURN_REASON, type ReturnReason } from '@core/constants/statuses';

export type ShippingRefundPolicy = {
  /** Refund the original outbound shipping charged on the sub-order. */
  refundOriginalShipping: boolean;
  /** Deduct platform/vendor returnShippingFee from the customer refund. */
  deductReturnShippingFee: boolean;
};

/**
 * Single named policy used by the PricingEngine refund path.
 * Seller-fault reasons refund outbound shipping; customer-fault do not,
 * and may deduct a reverse-pickup fee when configured.
 */
export function resolveShippingRefundPolicy(reasonCode: ReturnReason): ShippingRefundPolicy {
  switch (reasonCode) {
    case RETURN_REASON.DAMAGED:
    case RETURN_REASON.WRONG_ITEM:
    case RETURN_REASON.NOT_AS_DESCRIBED:
      return { refundOriginalShipping: true, deductReturnShippingFee: false };
    case RETURN_REASON.NO_LONGER_NEEDED:
    case RETURN_REASON.OTHER:
    default:
      return { refundOriginalShipping: false, deductReturnShippingFee: true };
  }
}
