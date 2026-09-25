import { PAYMENT_METHOD } from '@core/constants/statuses';
import { toPaise, type Paise } from './money';

/** The order fields that decide how a refund splits between wallet and Razorpay. */
export interface RefundSplitOrder {
  originalTotalAmount?: unknown;
  totalAmount?: unknown;
  razorpayAmountPaid?: unknown;
  walletAmountUsed?: unknown;
  razorpayPaymentId?: string | null;
  paymentMethod?: string | null;
}

const paise = (value: unknown): Paise => toPaise(Number(value ?? 0));

/**
 * The checkout total the customer's payment was split against, in paise. The frozen
 * `originalTotalAmount`, never less than what was actually paid (Razorpay + wallet)
 * or the current `totalAmount` — which covers rows written before the frozen column.
 * Sub-order cancellations and return refunds both split against this one number.
 */
export function orderCheckoutTotalPaise(order: RefundSplitOrder): Paise {
  const walletPaise = paise(order.walletAmountUsed);
  return Math.max(
    paise(order.originalTotalAmount),
    paise(order.razorpayAmountPaid) + walletPaise,
    paise(order.totalAmount),
    walletPaise,
  );
}

/**
 * What Razorpay charged for the order, in paise: the stored `razorpayAmountPaid`
 * (0 is a real zero), else the checkout total less the wallet part.
 */
export function orderRazorpayPaidPaise(order: RefundSplitOrder): Paise {
  if (order.razorpayAmountPaid != null) return paise(order.razorpayAmountPaid);
  return Math.max(0, orderCheckoutTotalPaise(order) - paise(order.walletAmountUsed));
}

/**
 * The wallet paid for all of it: a wallet-only checkout (nothing charged to Razorpay
 * and not COD), or a wallet amount that covers the whole checkout total. Every
 * refund on such an order goes back to the wallet.
 */
export function isWalletFundedOrder(order: RefundSplitOrder): boolean {
  const walletPaise = paise(order.walletAmountUsed);
  if (walletPaise <= 0) return false;
  const walletOnly =
    paise(order.razorpayAmountPaid) <= 0 &&
    !order.razorpayPaymentId &&
    order.paymentMethod !== PAYMENT_METHOD.COD;
  const totalPaise = orderCheckoutTotalPaise(order);
  return walletOnly || (totalPaise > 0 && walletPaise >= totalPaise);
}

/**
 * The wallet-funded part of a refund, in paise: the refund's share of the checkout
 * total that the wallet paid. The rest is the cash (Razorpay / COD) part. Callers
 * apply their own caps for what earlier refunds already returned.
 */
export function walletShareOfRefundPaise(order: RefundSplitOrder, refundPaise: Paise): Paise {
  const walletPaise = paise(order.walletAmountUsed);
  const totalPaise = orderCheckoutTotalPaise(order);
  if (walletPaise <= 0 || totalPaise <= 0 || refundPaise <= 0) return 0;
  return Math.min(refundPaise, Math.round((refundPaise * walletPaise) / totalPaise));
}
