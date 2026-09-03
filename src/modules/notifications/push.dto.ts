import { z } from 'zod';

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const RemovePushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
});
