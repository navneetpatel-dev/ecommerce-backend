import { z } from 'zod';

export const VerifyPaymentSchema = z
  .object({
    razorpay_order_id: z.string().min(1).optional(),
    razorpay_payment_id: z.string().min(1).optional(),
    razorpay_signature: z.string().min(1).optional(),
    razorpayOrderId: z.string().min(1).optional(),
    razorpayPaymentId: z.string().min(1).optional(),
    razorpaySignature: z.string().min(1).optional(),
  })
  .transform((body) => {
    const razorpayOrderId = body.razorpay_order_id ?? body.razorpayOrderId;
    const razorpayPaymentId = body.razorpay_payment_id ?? body.razorpayPaymentId;
    const razorpaySignature = body.razorpay_signature ?? body.razorpaySignature;
    return { razorpayOrderId, razorpayPaymentId, razorpaySignature };
  })
  .refine(
    (body) => Boolean(body.razorpayOrderId && body.razorpayPaymentId && body.razorpaySignature),
    { message: 'Missing verification fields' },
  );

export type VerifyPaymentRequest = z.infer<typeof VerifyPaymentSchema>;
