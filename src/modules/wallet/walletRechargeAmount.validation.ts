import { formatInrAmount } from '@core/pdf/pdfFormatters';
import { roundMoney } from '@modules/pricing/money';

export type WalletRechargeAmountLimits = {
  minInr: number;
  maxInr: number;
};

export type WalletRechargeAmountRangeError = 'below-min' | 'above-max';

export function checkWalletRechargeAmountRange(
  amountInr: number,
  limits: WalletRechargeAmountLimits,
): WalletRechargeAmountRangeError | null {
  const amount = roundMoney(amountInr);
  if (!Number.isFinite(amount) || amount <= 0) return 'below-min';
  if (amount < limits.minInr) return 'below-min';
  if (amount > limits.maxInr) return 'above-max';
  return null;
}

export function walletRechargeAmountRangeMessage(
  code: WalletRechargeAmountRangeError,
  limits: WalletRechargeAmountLimits,
): string {
  if (code === 'below-min') {
    return `Recharge amount must be at least ₹${formatInrAmount(limits.minInr)}`;
  }
  return `Recharge amount cannot exceed ₹${formatInrAmount(limits.maxInr)} per transaction`;
}
