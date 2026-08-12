import { z } from 'zod';
import {
  BUG_AFFECTED_MODULE_VALUES,
  BUG_ATTACHMENT_TYPE_VALUES,
  BUG_REPORT_SEVERITY_VALUES,
  BUG_REPORT_STATUS,
  BUG_REPORT_STATUS_VALUES,
  BUG_REPORTER_ROLE_VALUES,
} from '@core/constants/statuses';
import { keysetQuerySchema } from '@core/http/keysetPagination';

const AttachmentSchema = z.object({
  url: z.string().url(),
  type: z.enum(BUG_ATTACHMENT_TYPE_VALUES),
  durationSeconds: z.number().int().positive().nullable().optional(),
});

/** Reporter create body — severity/assignee/module/status remain admin-only (triage fields). */
export const CreateBugReportSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(5000),
    stepsToReproduce: z.string().trim().max(3000).optional().nullable(),
    attachmentUrls: z.array(AttachmentSchema).max(6).optional().default([]),
  })
  .strict();

export const TriageBugReportSchema = z.object({
  severity: z.enum(BUG_REPORT_SEVERITY_VALUES),
  affectedModule: z.enum(BUG_AFFECTED_MODULE_VALUES),
  assignedToId: z.string().uuid().nullable().optional(),
});

/** Same shape as triage — used to update severity/assignee/module without a status transition. */
export const UpdateBugAssignmentSchema = TriageBugReportSchema;

export const BugStatusSchema = z.object({
  status: z.enum([
    BUG_REPORT_STATUS.IN_PROGRESS,
    BUG_REPORT_STATUS.FIXED,
    BUG_REPORT_STATUS.VERIFIED,
    BUG_REPORT_STATUS.CLOSED,
  ]),
});

/** Accepts a bug UUID or human report number (e.g. BUG-000123). */
export const DuplicateBugReportSchema = z.object({
  duplicateOf: z.string().trim().min(1).max(64),
});

export const WontFixBugReportSchema = z.object({
  reason: z.string().trim().min(1).max(5000),
});

export const BugCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});

export const AdminBugListQuerySchema = keysetQuerySchema.extend({
  status: z.enum(BUG_REPORT_STATUS_VALUES).optional(),
  severity: z.enum(BUG_REPORT_SEVERITY_VALUES).optional(),
  affectedModule: z.enum(BUG_AFFECTED_MODULE_VALUES).optional(),
  reporterRole: z.enum(BUG_REPORTER_ROLE_VALUES).optional(),
});

/** Reporter list — status/severity filters only (no admin-only fields). */
export const MineBugListQuerySchema = keysetQuerySchema.extend({
  status: z.enum(BUG_REPORT_STATUS_VALUES).optional(),
  severity: z.enum(BUG_REPORT_SEVERITY_VALUES).optional(),
});

export type CreateBugReportRequest = z.infer<typeof CreateBugReportSchema>;
export type TriageBugReportRequest = z.infer<typeof TriageBugReportSchema>;
export type UpdateBugAssignmentRequest = z.infer<typeof UpdateBugAssignmentSchema>;
export type BugStatusRequest = z.infer<typeof BugStatusSchema>;
export type DuplicateBugReportRequest = z.infer<typeof DuplicateBugReportSchema>;
export type WontFixBugReportRequest = z.infer<typeof WontFixBugReportSchema>;
export type BugCommentRequest = z.infer<typeof BugCommentSchema>;
export type AdminBugListQuery = z.infer<typeof AdminBugListQuerySchema>;
export type MineBugListQuery = z.infer<typeof MineBugListQuerySchema>;
