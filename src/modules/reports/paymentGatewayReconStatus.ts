import { PAYMENT_METHOD, PAYMENT_STATUS } from '@core/constants/statuses';

/**
 * Mirrors the CASE in paymentGatewayReconciliation (reportGaps).
 * Keep SQL and this helper in sync.
 */
export function resolvePaymentGatewayReconStatus(input: {
  paymentMethod: string;
  paymentStatus: string;
  razorpayPaymentId: string | null;
  razorpayAmountPaid: number;
  walletAmountUsed: number;
  totalAmount: number;
}): string {
  const {
    paymentMethod,
    paymentStatus,
    razorpayPaymentId,
    razorpayAmountPaid,
    walletAmountUsed,
    totalAmount,
  } = input;

  if (paymentMethod !== PAYMENT_METHOD.RAZORPAY) return 'NOT_APPLICABLE';
  if (paymentStatus === PAYMENT_STATUS.PAID && razorpayPaymentId != null) {
    return 'MATCHED';
  }
  if (
    paymentStatus === PAYMENT_STATUS.PAID &&
    razorpayPaymentId == null &&
    walletAmountUsed > 0 &&
    (razorpayAmountPaid === 0 || walletAmountUsed >= totalAmount)
  ) {
    return 'WALLET_SETTLED';
  }
  if (
    paymentStatus === PAYMENT_STATUS.PAID &&
    razorpayPaymentId == null &&
    razorpayAmountPaid > 0
  ) {
    return 'MISSING_PG_REF';
  }
  if (paymentStatus === PAYMENT_STATUS.PENDING) return 'PENDING';
  if (paymentStatus === PAYMENT_STATUS.FAILED) return 'FAILED';
  if (paymentStatus === PAYMENT_STATUS.REFUNDED) return 'REFUNDED';
  return 'REVIEW';
}
