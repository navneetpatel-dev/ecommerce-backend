import { z } from 'zod';

export const CreateWalletRechargeSchema = z.object({
  amountInr: z.coerce.number().positive(),
  idempotencyKey: z.string().min(8).max(64).optional(),
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
