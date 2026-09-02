import { RAZORPAY_MIN_AMOUNT_PAISE } from '@core/constants/http';
import { checkoutAmountDue } from '@modules/pricing/displayMoney';
import { roundMoney, toPaise } from '@modules/pricing/money';

export type WalletFundingSplit = {
  walletAmountUsed: number;
  amountDue: number;
};

export function clampWalletApply(
  requestedWallet: number,
  balance: number,
  orderTotal: number,
): number {
  return roundMoney(
    Math.min(Math.max(0, requestedWallet), Math.max(0, balance), Math.max(0, orderTotal)),
  );
}

/**
 * If the online remainder is below Razorpay's minimum, absorb into a full-wallet
 * settle when balance covers the order; otherwise reject before debit/create.
 */
export function settleSubMinRazorpayRemainder(
  orderTotal: number,
  walletAmountUsed: number,
  balance: number,
  minOnlinePaise: number = RAZORPAY_MIN_AMOUNT_PAISE,
): WalletFundingSplit | { reject: true } {
  let used = roundMoney(Math.max(0, walletAmountUsed));
  let due = checkoutAmountDue(orderTotal, used);
  const duePaise = toPaise(due);
  if (duePaise > 0 && duePaise < minOnlinePaise) {
    if (balance >= orderTotal) {
      used = roundMoney(orderTotal);
      due = 0;
    } else {
      return { reject: true };
    }
  }
  return { walletAmountUsed: used, amountDue: due };
}
