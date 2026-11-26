import { z } from 'zod';

export const AdjustWalletSchema = z.object({
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: z.coerce.number().positive(),
  reason: z.string().min(3).max(255),
  pointSource: z.enum(['PURCHASED', 'PROMOTIONAL']).optional(),
});

/** Minimum length of a name/email search: stops the lookup being used to page through every account. */
export const WALLET_USER_SEARCH_MIN = 3;
export const WALLET_USER_SEARCH_MAX_RESULTS = 10;

export const WalletUserSearchSchema = z.object({
  search: z.string().trim().min(WALLET_USER_SEARCH_MIN).max(100),
  limit: z.coerce.number().int().min(1).max(WALLET_USER_SEARCH_MAX_RESULTS).default(WALLET_USER_SEARCH_MAX_RESULTS),
});

export type WalletUserSearchRequest = z.infer<typeof WalletUserSearchSchema>;
export type AdjustWalletRequest = z.infer<typeof AdjustWalletSchema>;
