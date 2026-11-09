import { z } from 'zod';
import { PAYMENT_METHOD_VALUES } from '@core/constants/statuses';

const money = (label: string) =>
  z.coerce
    .number({ error: (issue) => (issue.input === undefined ? undefined : `${label} must be a number`) })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(10_000_000);

const CashbackOfferFields = z.object({
  name: z.string().trim().min(3, 'Name the offer (at least 3 characters)').max(120),
  percent: z.coerce
    .number({ error: (issue) => (issue.input === undefined ? undefined : 'Percent must be a number') })
    .gt(0, 'Percent must be more than 0')
    .max(100, 'Percent cannot be more than 100'),
  maxCashback: money('Maximum cashback').positive('Maximum cashback must be more than 0').nullable().optional(),
  minOrderValue: money('Minimum order value').default(0),
  categoryIds: z.array(z.string().uuid()).max(50).default([]),
  paymentMethods: z.array(z.enum(PAYMENT_METHOD_VALUES)).max(PAYMENT_METHOD_VALUES.length).default([]),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(true),
});

const endsAfterStart = (body: { startsAt?: Date; endsAt?: Date | null }) =>
  !body.endsAt || !body.startsAt || body.endsAt > body.startsAt;
const endsAfterStartMessage = { message: 'The end must be after the start', path: ['endsAt'] };

export const CreateCashbackOfferSchema = CashbackOfferFields.refine(endsAfterStart, endsAfterStartMessage);
export type CreateCashbackOfferRequest = z.infer<typeof CreateCashbackOfferSchema>;

/** Every field optional; omitted fields keep their stored value (the merged offer is re-checked). */
export const UpdateCashbackOfferSchema = CashbackOfferFields.partial()
  .extend({
    minOrderValue: money('Minimum order value').optional(),
    categoryIds: z.array(z.string().uuid()).max(50).optional(),
    paymentMethods: z.array(z.enum(PAYMENT_METHOD_VALUES)).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(endsAfterStart, endsAfterStartMessage);
export type UpdateCashbackOfferRequest = z.infer<typeof UpdateCashbackOfferSchema>;

export const CashbackOfferListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CashbackOfferListQuery = z.infer<typeof CashbackOfferListQuerySchema>;
