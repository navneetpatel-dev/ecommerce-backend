/** User-facing wallet ledger descriptions — keep in sync with FE labels. */
export const WALLET_DESCRIPTIONS = {
  CHECKOUT_SPEND: 'Wallet spend on order',
  COD_REFUND: 'COD return refund',
  WALLET_PORTION_REFUND: 'Wallet portion refund',
  CASHBACK_CREDIT: 'Cashback for order',
  CASHBACK_CLAWBACK: 'Cashback clawback on return',
  TOPUP_CREDIT: 'Points recharge',
  PROMO_EXPIRY: 'Promotional points expired',
  ADMIN_ADJUSTMENT: 'Admin adjustment',
  GIFT_CARD_REDEMPTION: 'Gift card redeemed',
} as const;
