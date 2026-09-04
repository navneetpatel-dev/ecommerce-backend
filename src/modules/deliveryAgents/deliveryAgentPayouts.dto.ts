import { z } from 'zod';

export const AGENT_PAYOUT_PAYMENT_METHOD_VALUES = [
  'NEFT',
  'IMPS',
  'UPI',
  'RTGS',
  'CHEQUE',
  'CASH',
  'OTHER',
] as const;

export const MarkAgentPayoutPaidSchema = z.object({
  paymentMethod: z.enum(AGENT_PAYOUT_PAYMENT_METHOD_VALUES),
  paymentReferenceNumber: z.string().trim().min(1).max(120),
  paidAt: z.coerce.date().max(new Date(), 'Paid date cannot be in the future').optional(),
  proofOfPaymentUrl: z.string().url().optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const MarkAgentPayoutFailedSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const UpdateBankDetailsSchema = z.object({
  accountHolderName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().min(4).max(34),
  ifscCode: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
  upiId: z.string().trim().max(120).optional().nullable(),
});

export type MarkAgentPayoutPaidRequest = z.infer<typeof MarkAgentPayoutPaidSchema>;
export type MarkAgentPayoutFailedRequest = z.infer<typeof MarkAgentPayoutFailedSchema>;
export type UpdateBankDetailsRequest = z.infer<typeof UpdateBankDetailsSchema>;
