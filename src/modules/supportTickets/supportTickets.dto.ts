import { z } from 'zod';
import {
  SUPPORT_TICKET_CATEGORY_VALUES,
  SUPPORT_TICKET_PRIORITY_VALUES,
  SUPPORT_TICKET_STATUS_VALUES,
  TICKET_ATTACHMENT_TYPE_VALUES,
} from '@core/constants/statuses';
import { keysetQuerySchema } from '@core/http/keysetPagination';

const AttachmentSchema = z.object({
  url: z.string().url(),
  type: z.enum(TICKET_ATTACHMENT_TYPE_VALUES),
  durationSeconds: z.number().int().positive().nullable().optional(),
});

/**
 * Customer create — priority/assignee are server-derived.
 * `relatedVendorId` is accepted when category/order requires it (multi-vendor order or VENDOR category).
 */
export const CreateSupportTicketSchema = z
  .object({
    subject: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(5000),
    category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES),
    relatedOrderId: z.string().uuid().nullable().optional(),
    relatedVendorId: z.string().uuid().nullable().optional(),
    attachmentUrls: z.array(AttachmentSchema).max(6).optional().default([]),
  })
  .strict();

export const ReplySupportTicketSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachmentUrls: z.array(AttachmentSchema).max(6).optional().default([]),
});

export const ReassignSupportTicketSchema = z.object({
  assignedToId: z.string().uuid(),
});

export const RateSupportTicketSchema = z.object({
  rating: z.number().int().min(1).max(5),
});

export const UpdatePrioritySchema = z.object({
  priority: z.enum(SUPPORT_TICKET_PRIORITY_VALUES),
});

export const AdminTicketListQuerySchema = keysetQuerySchema.extend({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITY_VALUES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES).optional(),
  vendorId: z.string().uuid().optional(),
});

export const VendorTicketListQuerySchema = keysetQuerySchema.extend({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITY_VALUES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES).optional(),
});

/** Customer own-queue filters — same shape as vendor (no vendorId). */
export const CustomerTicketListQuerySchema = VendorTicketListQuerySchema;

export type CreateSupportTicketRequest = z.infer<typeof CreateSupportTicketSchema>;
export type ReplySupportTicketRequest = z.infer<typeof ReplySupportTicketSchema>;
export type ReassignSupportTicketRequest = z.infer<typeof ReassignSupportTicketSchema>;
export type RateSupportTicketRequest = z.infer<typeof RateSupportTicketSchema>;
export type UpdatePriorityRequest = z.infer<typeof UpdatePrioritySchema>;
export type AdminTicketListQuery = z.infer<typeof AdminTicketListQuerySchema>;
export type VendorTicketListQuery = z.infer<typeof VendorTicketListQuerySchema>;
export type CustomerTicketListQuery = z.infer<typeof CustomerTicketListQuerySchema>;
