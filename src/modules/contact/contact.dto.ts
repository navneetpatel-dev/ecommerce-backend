import { z } from 'zod';

export const CONTACT_TOPICS = ['ORDER', 'RETURNS', 'PAYMENT', 'ACCOUNT', 'SELLER', 'FEEDBACK', 'OTHER'] as const;

export const CONTACT_TOPIC_LABELS: Record<(typeof CONTACT_TOPICS)[number], string> = {
  ORDER: 'Order help',
  RETURNS: 'Returns & refunds',
  PAYMENT: 'Payments',
  ACCOUNT: 'My account',
  SELLER: 'Selling on Marketplace',
  FEEDBACK: 'Feedback',
  OTHER: 'Something else',
};

export const CreateContactMessageSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(255),
    topic: z.enum(CONTACT_TOPICS),
    subject: z.string().trim().min(3).max(200),
    message: z.string().trim().min(10).max(5000),
    /** Honeypot: real visitors never see or fill this field. */
    website: z.string().optional(),
  })
  .strict();

export type CreateContactMessageRequest = z.infer<typeof CreateContactMessageSchema>;
