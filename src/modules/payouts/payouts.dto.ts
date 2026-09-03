import { z } from 'zod';

export const PAYOUT_PAYMENT_METHOD_VALUES = [
  'NEFT',
  'IMPS',
  'UPI',
  'RTGS',
  'CHEQUE',
  'CASH',
  'OTHER',
] as const;

export const MarkPayoutPaidSchema = z.object({
  paymentMethod: z.enum(PAYOUT_PAYMENT_METHOD_VALUES),
  paymentReferenceNumber: z.string().trim().min(1).max(120),
  paidAt: z.coerce.date().max(new Date(), 'Paid date cannot be in the future').optional(),
  proofOfPaymentUrl: z.string().url().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const MarkPayoutFailedSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export type MarkPayoutPaidRequest = z.infer<typeof MarkPayoutPaidSchema>;
export type MarkPayoutFailedRequest = z.infer<typeof MarkPayoutFailedSchema>;
