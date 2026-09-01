import { z } from 'zod';

export const AdjustWalletSchema = z.object({
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: z.coerce.number().positive(),
  reason: z.string().min(3).max(255),
  pointSource: z.enum(['PURCHASED', 'PROMOTIONAL']).optional(),
});

export type AdjustWalletRequest = z.infer<typeof AdjustWalletSchema>;
