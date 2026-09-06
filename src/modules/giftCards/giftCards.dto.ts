import { z } from 'zod';
import { GIFT_CARD_MIN_AMOUNT_INR, GIFT_CARD_MAX_AMOUNT_INR } from './giftCards.constants';

export const PurchaseGiftCardSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: 'Amount must be a number' })
    .finite('Amount must be a valid number')
    .min(GIFT_CARD_MIN_AMOUNT_INR, `Minimum gift card amount is ₹${GIFT_CARD_MIN_AMOUNT_INR}`)
    .max(GIFT_CARD_MAX_AMOUNT_INR, `Maximum gift card amount is ₹${GIFT_CARD_MAX_AMOUNT_INR}`),
  recipientEmail: z.string().trim().email('Enter a valid recipient email'),
  recipientName: z.string().trim().max(120).optional(),
  message: z.string().trim().max(500).optional(),
});
export type PurchaseGiftCardRequest = z.infer<typeof PurchaseGiftCardSchema>;

export const VerifyGiftCardPurchaseSchema = z
  .object({
    razorpay_order_id: z.string().min(1).optional(),
    razorpay_payment_id: z.string().min(1).optional(),
    razorpay_signature: z.string().min(1).optional(),
    razorpayOrderId: z.string().min(1).optional(),
    razorpayPaymentId: z.string().min(1).optional(),
    razorpaySignature: z.string().min(1).optional(),
    giftCardId: z.string().uuid().optional(),
  })
  .transform((body) => ({
    razorpayOrderId: body.razorpay_order_id ?? body.razorpayOrderId,
    razorpayPaymentId: body.razorpay_payment_id ?? body.razorpayPaymentId,
    razorpaySignature: body.razorpay_signature ?? body.razorpaySignature,
    giftCardId: body.giftCardId,
  }))
  .refine(
    (body) => Boolean(body.razorpayOrderId && body.razorpayPaymentId && body.razorpaySignature),
    { message: 'Razorpay payment details are required' },
  );
export type VerifyGiftCardPurchaseRequest = z.infer<typeof VerifyGiftCardPurchaseSchema>;

export const RedeemGiftCardSchema = z.object({
  code: z.string().trim().min(4).max(24),
});
export type RedeemGiftCardRequest = z.infer<typeof RedeemGiftCardSchema>;
