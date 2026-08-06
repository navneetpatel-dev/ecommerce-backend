import { z } from 'zod';
import { SHIPPING_METHOD_VALUES } from '@core/constants/statuses';

export const GetShippingRatesSchema = z.object({
  pincode: z.string(),
  state: z.string().optional(),
  weight: z.coerce.number(),
  method: z.enum(SHIPPING_METHOD_VALUES).optional(),
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

export const WebhookPayloadSchema = z.object({
  trackingNumber: z.string().min(1),
  status: z.string().min(1),
});

export type GetShippingRatesRequest = z.infer<typeof GetShippingRatesSchema>;
export type CreateZoneRequest = z.infer<typeof CreateZoneSchema>;
export type UpdateZoneRequest = z.infer<typeof UpdateZoneSchema>;
export type CreateRateRequest = z.infer<typeof CreateRateSchema>;
export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
