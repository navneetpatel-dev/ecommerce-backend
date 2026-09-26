import { ORDER_STATUS } from '@core/constants/statuses';
import { toPaise, type Paise } from './money';
import {
  isWalletFundedOrder,
  orderRazorpayPaidPaise,
  walletShareOfRefundPaise,
  type RefundSplitOrder,
} from './refundSplit';

/**
 * A part (sub-order) of an order that was reversed and refunded: cancelled before
 * dispatch, or RETURNED — came back undelivered (RTO). Returns after delivery keep the
 * part DELIVERED and are refunded through return requests instead.
 */
export function isReversedPart(status: string | null | undefined): boolean {
  return status === ORDER_STATUS.CANCELLED || status === ORDER_STATUS.RETURNED;
}

/**
 * The cash (Razorpay) refund for one reversed part, in paise: its total less its
 * wallet share, never more than Razorpay still holds after the other reversed parts'
 * cash shares. The last part of the order to be reversed takes everything left, which
 * includes order-level charges no part carries (the gift-wrap fee).
 */
export function reversedPartCashSharePaise(
  order: RefundSplitOrder,
  partPaise: Paise,
  otherReversedPartsPaise: Paise[],
  lastPart: boolean,
): Paise {
  const cashShare = (totalPaise: Paise) =>
    isWalletFundedOrder(order) ? 0 : totalPaise - walletShareOfRefundPaise(order, totalPaise);
  const alreadyRefunded = otherReversedPartsPaise.reduce((sum, paise) => sum + cashShare(paise), 0);
  const remaining = Math.max(0, orderRazorpayPaidPaise(order) - alreadyRefunded);
  return lastPart ? remaining : Math.min(cashShare(partPaise), remaining);
}

/** A part as the COD cash-due calculation reads it. */
export interface CodPart {
  status: string | null | undefined;
  totalPaise: Paise;
}

/**
 * Cash still owed at the door on a COD order, in paise: the parts kept (not cancelled
 * or RTO'd) plus the order-level gift-wrap fee, less the wallet money on them — the
 * wallet paid at checkout minus each reversed part's wallet share, already returned.
 * 0 once no part is kept. The shipments split exactly this amount between them.
 */
export function codCashDuePaise(
  order: RefundSplitOrder & { giftWrapFeeAmount?: unknown },
  parts: CodPart[],
): Paise {
  const kept = parts.filter((part) => !isReversedPart(part.status));
  if (kept.length === 0) return 0;
  const reversed = parts.filter((part) => isReversedPart(part.status));
  const keptPaise =
    kept.reduce((sum, part) => sum + part.totalPaise, 0) +
    toPaise(Number(order.giftWrapFeeAmount ?? 0));
  const walletReturnedPaise = reversed.reduce(
    (sum, part) => sum + walletShareOfRefundPaise(order, part.totalPaise),
    0,
  );
  const walletOnKeptPaise = Math.max(
    0,
    toPaise(Number(order.walletAmountUsed ?? 0)) - walletReturnedPaise,
  );
  return Math.max(0, keptPaise - walletOnKeptPaise);
}
