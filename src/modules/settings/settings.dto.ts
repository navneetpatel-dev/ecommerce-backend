import { z } from 'zod';

/** 15-character GSTIN: state code, PAN, entity number, 'Z', check digit. */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const BaseUpdateSettingsSchema = z.object({
  defaultCommissionRate: z.number().min(0).max(100),
  tcsRatePercent: z.number().min(0).max(100).default(0.5),
  tdsRatePercent: z.number().min(0).max(100).default(0.1),
  tds194oExemptionThreshold: z.number().min(0).default(500000),
  commissionGstRatePercent: z.number().min(0).max(100).default(18),
  platformGstin: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === '' || GSTIN_PATTERN.test(value), 'Enter a valid 15-character GSTIN')
    .default(''),
  platformLegalName: z.string().trim().max(200).default(''),
  platformState: z.string().trim().max(64).default(''),
  autoApproveProducts: z.boolean(),
  autoApproveReviews: z.boolean().default(true),
  autoApproveQuestions: z.boolean().default(true),
  defaultReturnWindow: z.number().int().positive().max(365),
  payoutCycle: z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  freeShippingThreshold: z.number().min(0),
  returnShippingFee: z.number().min(0).default(0),
  supportEmail: z.string().trim().email(),
  supportHours: z.string().trim().min(1).max(200),
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
  walletRechargePresetsInr: z.array(z.number().min(1)).max(8).default([500, 1000, 2000, 5000]),
  promotionalPointsTtlDays: z.number().int().min(0).default(0),
  refundSlaBusinessDays: z.number().int().positive().max(30).default(7),
  /** Master switch for the automated weekly admin report email digest. */
  scheduledReportsEnabled: z.boolean().default(false),
  /** Report catalog `type` keys (see reports.constants ADMIN_SCHEDULABLE_REPORT_TYPES) to include. */
  scheduledReportsTypes: z.array(z.string()).default(['reconciliation', 'gmv-sales']),
  /** Explicit recipient email addresses (v1: no role-based fan-out). */
  scheduledReportsRecipients: z.array(z.string().trim().toLowerCase().email()).max(25).default([]),
  /** 0=Sunday..6=Saturday. Checked by the job body against the fixed hourly trigger. */
  scheduledReportsDayOfWeek: z.number().int().min(0).max(6).default(1),
  scheduledReportsHourUtc: z.number().int().min(0).max(23).default(6),
  maintenanceEnabled: z.boolean().default(false),
  maintenanceMessage: z.string().trim().max(500).default(''),
  maintenanceUntil: z.string().datetime({ offset: true }).nullable().default(null),
  welcomeOfferEnabled: z.boolean().default(true),
  welcomeOfferPercent: z.number().min(1).max(100).default(10),
  welcomeOfferMaxDiscount: z.number().min(0).default(200),
  welcomeOfferMinOrder: z.number().min(0).default(0),
  welcomeOfferValidDays: z.number().int().min(1).max(365).default(30),
});

/** Cross-field rules a single field cannot express. */
export const UpdateSettingsSchema = BaseUpdateSettingsSchema.superRefine((value, ctx) => {
  if (value.codMaxOrderValue != null && value.codMaxOrderValue < value.codMinOrderValue) {
    ctx.addIssue({
      code: 'custom',
      path: ['codMaxOrderValue'],
      message: 'COD maximum order value must be at least the minimum',
    });
  }
  if (value.walletMinRechargeInr > value.walletMaxRechargeInr) {
    ctx.addIssue({
      code: 'custom',
      path: ['walletMinRechargeInr'],
      message: 'Minimum recharge cannot exceed the maximum recharge',
    });
  }
  if (value.scheduledReportsEnabled && value.scheduledReportsTypes.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['scheduledReportsTypes'],
      message: 'Select at least one report while scheduled reports are on',
    });
  }
  if (value.maintenanceEnabled && value.maintenanceUntil && Date.parse(value.maintenanceUntil) <= Date.now()) {
    ctx.addIssue({
      code: 'custom',
      path: ['maintenanceUntil'],
      message: 'The expected end time must be in the future',
    });
  }
});

export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsSchema>;
