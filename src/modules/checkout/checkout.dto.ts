import { z } from 'zod';

export const CreateCheckoutSchema = z.object({
  shippingAddressId: z.string().uuid(),
  couponCode: z.string().optional(),
  paymentMethod: z.enum(['RAZORPAY', 'WALLET', 'MIXED']).default('RAZORPAY'),
  walletAmountToUse: z.number().min(0).default(0),
});

export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutSchema>;
