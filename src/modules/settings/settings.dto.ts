import { z } from 'zod';

export const UpdateSettingsSchema = z.object({
  defaultCommissionRate: z.number().min(0).max(100),
  tcsRatePercent: z.number().min(0).max(100).default(0.5),
  tdsRatePercent: z.number().min(0).max(100).default(0.1),
  commissionGstRatePercent: z.number().min(0).max(100).default(18),
  platformGstin: z.string().max(20).default(''),
  platformLegalName: z.string().max(200).default(''),
  platformState: z.string().max(64).default(''),
  autoApproveProducts: z.boolean(),
  defaultReturnWindow: z.number().int().positive(),
  payoutCycle: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  freeShippingThreshold: z.number().min(0),
  returnShippingFee: z.number().min(0).default(0),
  supportEmail: z.string().email(),
  supportHours: z.string().min(1),
  /** Required on admin save so omitted fields cannot silently reset to defaults. */
  ticketReopenWindowDays: z.number().int().positive().max(365),
  bugVerifyWindowDays: z.number().int().positive().max(365),
  bugCloseWindowDays: z.number().int().positive().max(365),
  codEnabled: z.boolean().default(true),
  codMinOrderValue: z.number().min(0).default(0),
  codMaxOrderValue: z.number().min(0).nullable().default(null),
  walletRechargeEnabled: z.boolean().default(true),
  walletMinRechargeInr: z.number().min(1).default(1),
  walletMaxRechargeInr: z.number().min(1).default(10000),
  walletMaxBalancePoints: z.number().min(0).default(50000),
  walletRechargePresetsInr: z.array(z.number().min(1)).default([500, 1000, 2000, 5000]),
  promotionalPointsTtlDays: z.number().int().min(0).default(0),
  refundSlaBusinessDays: z.number().int().positive().max(30).default(7),
  deliveryAgentPerTaskEarning: z.number().min(0).default(20),
  /** Master switch for the automated weekly admin report email digest. */
  scheduledReportsEnabled: z.boolean().default(false),
  /** Report catalog `type` keys (see reports.constants ADMIN_SCHEDULABLE_REPORT_TYPES) to include. */
  scheduledReportsTypes: z.array(z.string()).default(['reconciliation', 'gmv-sales']),
  /** Explicit recipient email addresses (v1: no role-based fan-out). */
  scheduledReportsRecipients: z.array(z.string().email()).default([]),
  /** 0=Sunday..6=Saturday. Checked by the job body against the fixed hourly trigger. */
  scheduledReportsDayOfWeek: z.number().int().min(0).max(6).default(1),
  scheduledReportsHourUtc: z.number().int().min(0).max(23).default(6),
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsSchema>;
