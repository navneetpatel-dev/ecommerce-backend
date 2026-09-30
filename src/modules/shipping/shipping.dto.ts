import { z } from 'zod';
import { SHIPPING_METHOD_VALUES } from '@core/constants/statuses';
import { PINCODE_PATTERN } from '@core/constants/pincode';
import { ERROR_MESSAGES } from '@core/constants/errors';

export const GetShippingRatesSchema = z
  .object({
    pincode: z.string().trim().regex(PINCODE_PATTERN, ERROR_MESSAGES.PINCODE_INVALID),
    state: z.string().optional(),
    weight: z.preprocess((value) => (value === undefined || value === '' ? undefined : value), z.coerce.number().positive().optional()),
    method: z.enum(SHIPPING_METHOD_VALUES).optional(),
    productId: z.string().uuid().optional(),
    variantId: z.string().uuid().optional(),
    vendorId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.productId && !value.vendorId && value.weight == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['weight'],
        message: ERROR_MESSAGES.SHIPPING_WEIGHT_REQUIRED,
      });
    }
  });

/** The basket's vendors, so the answer can name the one that does not ship there. */
function toVendorIdList(value: string | string[]): string[] {
  return (Array.isArray(value) ? value : value.split(',')).map((part) => part.trim()).filter(Boolean);
}

export const GetServiceabilitySchema = z.object({
  pincode: z.string().trim().regex(PINCODE_PATTERN, ERROR_MESSAGES.PINCODE_INVALID),
  state: z.string().trim().optional(),
  vendorIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => (value === undefined ? undefined : toVendorIdList(value)))
    .pipe(z.array(z.string().uuid()).max(50).optional()),
});

export const CreateZoneSchema = z.object({
  name: z.string().min(1),
  states: z.array(z.string()).optional(),
  pincodePrefixes: z.array(z.string()).optional(),
});

export const UpdateZoneSchema = z.object({
  name: z.string().min(1).optional(),
  states: z.array(z.string()).optional(),
  pincodePrefixes: z.array(z.string()).optional(),
});

export const CreateRateSchema = z.object({
  zoneId: z.string().uuid(),
  method: z.enum(SHIPPING_METHOD_VALUES),
  minWeightGrams: z.number().int().min(0).optional(),
  maxWeightGrams: z.number().int().positive(),
  price: z.number().min(0),
  estimatedDays: z.number().int().positive(),
  freeShippingThreshold: z.number().min(0).optional(),
  vendorId: z.string().uuid().optional(),
});

export const UpdateRateSchema = CreateRateSchema.partial();

export const RescheduleDeliverySchema = z.object({
  slot: z.string().trim().min(3).max(64),
});

export const SubmitDeliveryRatingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const WebhookPayloadSchema = z.object({
  trackingNumber: z.string().min(1),
  status: z.string().min(1),
});

export type GetShippingRatesRequest = z.infer<typeof GetShippingRatesSchema>;
export type CreateZoneRequest = z.infer<typeof CreateZoneSchema>;
export type UpdateZoneRequest = z.infer<typeof UpdateZoneSchema>;
export type CreateRateRequest = z.infer<typeof CreateRateSchema>;
export type UpdateRateRequest = z.infer<typeof UpdateRateSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
export type RescheduleDeliveryRequest = z.infer<typeof RescheduleDeliverySchema>;
export type SubmitDeliveryRatingRequest = z.infer<typeof SubmitDeliveryRatingSchema>;
