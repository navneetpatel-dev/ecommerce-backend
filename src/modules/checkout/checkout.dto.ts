import { z } from 'zod';
import { PAYMENT_METHOD_VALUES } from '@core/constants/statuses';

const PaymentMethodInput = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.enum(PAYMENT_METHOD_VALUES));

export const CreateCheckoutSchema = z
  .object({
    shippingAddressId: z.string().uuid().optional(),
    addressId: z.string().uuid().optional(),
    couponCode: z.string().optional().nullable(),
    couponCodes: z.array(z.string()).optional(),
    paymentMethod: PaymentMethodInput.default('RAZORPAY'),
    walletAmountToUse: z.coerce.number().min(0).optional().default(0),
    shippingMethodByVendor: z.record(z.string()).optional(),
    giftWrap: z.boolean().optional().default(false),
    giftMessage: z.string().trim().max(500).optional(),
  })
  .transform((body) => {
    const shippingAddressId = body.shippingAddressId ?? body.addressId;
    return {
      shippingAddressId: shippingAddressId as string,
      couponCode: body.couponCode ?? undefined,
      couponCodes: body.couponCodes,
      paymentMethod: body.paymentMethod,
      walletAmountToUse: body.walletAmountToUse ?? 0,
      shippingMethodByVendor: body.shippingMethodByVendor ?? {},
      giftWrap: body.giftWrap ?? false,
      giftMessage: body.giftMessage || undefined,
    };
  })
  .refine((body) => Boolean(body.shippingAddressId), {
    message: 'shippingAddressId or addressId is required',
    path: ['shippingAddressId'],
  });

export const CheckoutQuoteSchema = z
  .object({
    shippingAddressId: z.string().uuid().optional(),
    addressId: z.string().uuid().optional(),
    couponCode: z.string().optional().nullable(),
    couponCodes: z.array(z.string()).optional(),
    walletAmountToUse: z.coerce.number().min(0).optional().default(0),
    shippingMethodByVendor: z.record(z.string()).optional(),
    giftWrap: z.boolean().optional().default(false),
    giftMessage: z.string().trim().max(500).optional(),
  })
  .transform((body) => ({
    shippingAddressId: (body.shippingAddressId ?? body.addressId) as string,
    couponCode: body.couponCode ?? undefined,
    couponCodes: body.couponCodes,
    walletAmountToUse: body.walletAmountToUse ?? 0,
    shippingMethodByVendor: body.shippingMethodByVendor ?? {},
    giftWrap: body.giftWrap ?? false,
    giftMessage: body.giftMessage || undefined,
  }))
  .refine((body) => Boolean(body.shippingAddressId), {
    message: 'shippingAddressId or addressId is required',
    path: ['shippingAddressId'],
  });

export const CancelCheckoutSchema = z.object({
  orderId: z.string().uuid(),
});

export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutSchema>;
export type CheckoutQuoteRequest = z.infer<typeof CheckoutQuoteSchema>;
export type CancelCheckoutRequest = z.infer<typeof CancelCheckoutSchema>;
