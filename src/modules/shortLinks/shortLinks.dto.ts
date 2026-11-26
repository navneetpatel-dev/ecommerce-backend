import { z } from 'zod';

/**
 * `metadata` is deliberately not part of the contract: previews are derived from the catalog.
 * Unknown keys (including an old client's `metadata`) are stripped, not rejected.
 */
export const CreateShortLinkSchema = z.object({
  targetUrl: z.string().trim().max(2048).optional(),
  resourceType: z.literal('PRODUCT').optional(),
  resourceId: z.string().uuid().optional(),
});

export const ShortLinkCodeParamsSchema = z.object({
  code: z.string().trim().min(1).max(200),
});

export type CreateShortLinkInput = z.infer<typeof CreateShortLinkSchema>;
