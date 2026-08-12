import { z } from 'zod';

export const SubscribeNewsletterSchema = z
  .object({
    email: z.string().trim().email().max(255),
  })
  .strict();

export type SubscribeNewsletterRequest = z.infer<typeof SubscribeNewsletterSchema>;
