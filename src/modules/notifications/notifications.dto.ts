import { z } from 'zod';
import { ROLE_VALUES } from '@core/constants/statuses';

export const ListNotificationLogsQuerySchema = z.object({
  search: z.string().trim().optional(),
  type: z.string().trim().min(1).optional(),
  channel: z.enum(['EMAIL', 'SMS', 'PUSH']).optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED']).optional(),
  errorCategory: z.enum(['TEMPORARY', 'PERMANENT', 'RENDER', 'RECIPIENT', 'CONFIG', 'UNCERTAIN']).optional(),
});
export type ListNotificationLogsQuery = z.infer<typeof ListNotificationLogsQuerySchema>;

const RoleEnum = z.enum(ROLE_VALUES);

export const BroadcastTargetConfigSchema = z.object({
  mode: z.enum(['roles', 'users', 'user_segment', 'vendor_segment']).optional(),
  allUsers: z.boolean().optional(),
  role: RoleEnum.optional(),
  roles: z.array(RoleEnum).max(20).optional(),
  userIds: z.array(z.string().uuid()).max(1000).optional(),
  emails: z.array(z.string().email()).max(1000).optional(),
  userSegment: z
    .object({
      status: z.enum(['ACTIVE', 'BLOCKED', 'ALL']).optional(),
      emailVerified: z.boolean().optional(),
      emailMarketingConsent: z.boolean().optional(),
      signedUpWithinDays: z.number().int().min(1).max(365).optional(),
      activity: z
        .enum(['ordered_last_30d', 'inactive_30d', 'inactive_90d', 'repeat_buyers', 'abandoned_cart'])
        .optional(),
      state: z.string().trim().max(80).optional(),
      city: z.string().trim().max(80).optional(),
    })
    .optional(),
  vendorSegment: z
    .object({
      vendorStatus: z.enum(['APPROVED', 'PENDING', 'SUSPENDED']).optional(),
      kycVerified: z.boolean().optional(),
      categoryIds: z.array(z.string().uuid()).max(50).optional(),
      state: z.string().trim().max(80).optional(),
      minPerformanceScore: z.number().min(0).max(5).optional(),
      maxPerformanceScore: z.number().min(0).max(5).optional(),
    })
    .optional(),
  excludeUserIds: z.array(z.string().uuid()).max(500).optional(),
  excludeRoles: z.array(RoleEnum).max(20).optional(),
});

export const BroadcastNotificationSchema = BroadcastTargetConfigSchema.extend({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
  ctaLabel: z.string().trim().max(80).optional(),
  ctaUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  classification: z.enum(['operational', 'marketing']).optional(),
  priority: z.enum(['standard', 'high']).optional(),
  channels: z.array(z.enum(['EMAIL', 'PUSH', 'IN_APP'])).min(1).max(3).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
}).refine(
  (d) =>
    Boolean(d.allUsers) ||
    Boolean(d.role) ||
    Boolean(d.roles?.length) ||
    Boolean(d.userIds?.length) ||
    Boolean(d.emails?.length) ||
    d.mode === 'user_segment' ||
    d.mode === 'vendor_segment',
  {
    message: 'Select a role, specific users, or segment to target.',
    path: ['role'],
  },
);
export type BroadcastNotificationRequest = z.infer<typeof BroadcastNotificationSchema>;

export const BroadcastPreviewSchema = z.object({
  targetConfig: BroadcastTargetConfigSchema,
  classification: z.enum(['operational', 'marketing']).optional(),
  channels: z.array(z.enum(['EMAIL', 'PUSH', 'IN_APP'])).optional(),
});

export const BroadcastRenderPreviewSchema = z.object({
  subject: z.string().max(200),
  message: z.string().max(5000),
  ctaLabel: z.string().max(80).optional(),
  ctaUrl: z.string().max(500).optional(),
  classification: z.enum(['operational', 'marketing']).optional(),
  theme: z.enum(['light', 'dark']).optional(),
});
