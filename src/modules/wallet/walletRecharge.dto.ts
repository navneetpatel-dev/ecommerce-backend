import { z } from 'zod';
import {
  checkWalletRechargeAmountRange,
  walletRechargeAmountRangeMessage,
} from './walletRechargeAmount.validation';

export type WalletRechargeSchemaLimits = {
  minInr: number;
  maxInr: number;
};

export function buildCreateWalletRechargeSchema(limits: WalletRechargeSchemaLimits) {
  return z.object({
    amountInr: z.coerce
      .number({ invalid_type_error: 'Recharge amount must be a number' })
      .finite('Recharge amount must be a valid number')
      .positive('Recharge amount must be greater than zero')
      .superRefine((value, ctx) => {
        const code = checkWalletRechargeAmountRange(value, limits);
        if (code) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: walletRechargeAmountRangeMessage(code, limits),
          });
        }
      }),
    idempotencyKey: z.string().min(8).max(64).optional(),
  });
}

/** Default limits for unit tests and offline parsing. */
export const CreateWalletRechargeSchema = buildCreateWalletRechargeSchema({
  minInr: 1,
  maxInr: 10000,
});

export const VerifyWalletRechargeSchema = z
  .object({
    razorpay_order_id: z.string().min(1).optional(),
    razorpay_payment_id: z.string().min(1).optional(),
    razorpay_signature: z.string().min(1).optional(),
    razorpayOrderId: z.string().min(1).optional(),
    razorpayPaymentId: z.string().min(1).optional(),
    razorpaySignature: z.string().min(1).optional(),
    rechargeId: z.string().uuid().optional(),
  })
  .transform((body) => ({
    razorpayOrderId: body.razorpay_order_id ?? body.razorpayOrderId,
    razorpayPaymentId: body.razorpay_payment_id ?? body.razorpayPaymentId,
    razorpaySignature: body.razorpay_signature ?? body.razorpaySignature,
    rechargeId: body.rechargeId,
  }))
  .refine(
    (body) =>
      Boolean(body.razorpayOrderId && body.razorpayPaymentId && body.razorpaySignature),
    { message: 'Razorpay payment details are required' },
  );

export type CreateWalletRechargeRequest = z.infer<typeof CreateWalletRechargeSchema>;
