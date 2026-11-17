import { z } from 'zod';

export const SubscribeNewsletterSchema = z
  .object({
    email: z.string().trim().email().max(255),
  })
  .strict();

export type SubscribeNewsletterRequest = z.infer<typeof SubscribeNewsletterSchema>;

export const NewsletterTokenSchema = z.object({ token: z.string().min(10).max(2000) }).strict();
