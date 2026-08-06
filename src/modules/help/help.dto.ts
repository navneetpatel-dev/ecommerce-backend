import { z } from 'zod';

export const CreateHelpTicketSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(255),
  topic: z.enum([
    'ORDERS',
    'SHIPPING',
    'RETURNS',
    'PAYMENTS',
    'ACCOUNT',
    'PRODUCTS',
    'SELLERS',
    'OTHER',
  ]),
  subject: z.string().min(3).max(200),
  message: z.string().min(20).max(5000),
  orderId: z.string().uuid().optional().nullable(),
});

export type CreateHelpTicketRequest = z.infer<typeof CreateHelpTicketSchema>;
