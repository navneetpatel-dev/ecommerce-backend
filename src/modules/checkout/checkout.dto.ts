import { z } from 'zod';

const PaymentMethodInput = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .pipe(z.enum(['RAZORPAY', 'COD']));

export const CreateCheckoutSchema = z
  .object({
    shippingAddressId: z.string().uuid().optional(),
    addressId: z.string().uuid().optional(),
    couponCode: z.string().optional().nullable(),
    paymentMethod: PaymentMethodInput.default('RAZORPAY'),
    shippingMethodByVendor: z.record(z.string()).optional(),
  })
  .transform((body) => {
    const shippingAddressId = body.shippingAddressId ?? body.addressId;
    return {
      shippingAddressId: shippingAddressId as string,
      couponCode: body.couponCode ?? undefined,
      paymentMethod: body.paymentMethod,
      shippingMethodByVendor: body.shippingMethodByVendor ?? {},
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
    shippingMethodByVendor: z.record(z.string()).optional(),
  })
  .transform((body) => ({
    shippingAddressId: (body.shippingAddressId ?? body.addressId) as string,
    couponCode: body.couponCode ?? undefined,
    shippingMethodByVendor: body.shippingMethodByVendor ?? {},
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
