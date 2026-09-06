import { z } from 'zod';
import { ROLE_VALUES } from '@core/constants/statuses';

export const ListNotificationLogsQuerySchema = z.object({
  type: z.string().trim().min(1).optional(),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH']).optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED']).optional(),
});
export type ListNotificationLogsQuery = z.infer<typeof ListNotificationLogsQuerySchema>;

export const BroadcastNotificationSchema = z
  .object({
    role: z.enum(ROLE_VALUES).optional(),
    userIds: z.array(z.string().uuid()).min(1).max(500).optional(),
    subject: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(5000),
  })
  .refine((data) => Boolean(data.role) || Boolean(data.userIds?.length), {
    message: 'Provide a role or a list of userIds to target.',
    path: ['role'],
  });
export type BroadcastNotificationRequest = z.infer<typeof BroadcastNotificationSchema>;
