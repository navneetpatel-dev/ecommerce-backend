import { z } from 'zod';
import {
  VENDOR_DOCUMENT_TYPE_VALUES,
  VENDOR_ENTITY_TYPE_VALUES,
  VENDOR_STATUS_VALUES,
} from '@core/constants/statuses';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@core/constants/http';

export const RegisterVendorSchema = z.object({
  businessName: z.string().min(1),
  entityType: z.enum(VENDOR_ENTITY_TYPE_VALUES),
  categoryIds: z.array(z.string().uuid()).min(1),
  gstNumber: z.string().optional(),
  state: z.string().min(2).optional(),
  bankDetails: z.record(z.unknown()).default({}),
  description: z.string().optional(),
  /** Optional soft-check fields (not stored separately; mirrored into bankDetails when present). */
  panHolderName: z.string().optional(),
  bankAccountHolderName: z.string().optional(),
});

export const UpdateVendorSchema = z.object({
  businessName: z.string().min(1).optional(),
  entityType: z.enum(VENDOR_ENTITY_TYPE_VALUES).optional(),
  categoryIds: z.array(z.string().uuid()).min(1).optional(),
  gstNumber: z.string().optional(),
  state: z.string().min(2).optional(),
  addressLine1: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  pincode: z.string().max(12).optional().nullable(),
  bankDetails: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  /** Optional override of platform returnShippingFee (rupees). Null clears override. */
  returnShippingFee: z.number().min(0).nullable().optional(),
  codEnabled: z.boolean().optional(),
});

export const ApproveVendorSchema = z.object({
  commissionRate: z.number().min(0).max(100).optional(),
});

export const RejectVendorSchema = z.object({
  reason: z.string().min(1),
});

export const SuspendVendorSchema = z.object({
  reason: z.string().min(1),
});

export const GetVendorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  status: z.enum(VENDOR_STATUS_VALUES).optional(),
  search: z.string().optional(),
});

export const VendorDirectoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  search: z.string().optional(),
});

export const UploadDocumentSchema = z.object({
  type: z.enum(VENDOR_DOCUMENT_TYPE_VALUES),
  url: z.string().url(),
});

export const RejectDocumentSchema = z.object({
  reason: z.string().min(1),
});

export const ResolveDocumentsQuerySchema = z.object({
  entityType: z.enum(VENDOR_ENTITY_TYPE_VALUES),
  categoryIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (!value) return [] as string[];
      const raw = Array.isArray(value) ? value : value.split(',');
      return raw.map((part) => part.trim()).filter(Boolean);
    }),
});

export type RegisterVendorRequest = z.infer<typeof RegisterVendorSchema>;
export type UpdateVendorRequest = z.infer<typeof UpdateVendorSchema>;
export type ApproveVendorRequest = z.infer<typeof ApproveVendorSchema>;
export type RejectVendorRequest = z.infer<typeof RejectVendorSchema>;
export type SuspendVendorRequest = z.infer<typeof SuspendVendorSchema>;
export type GetVendorsQuery = z.infer<typeof GetVendorsQuerySchema>;
export type VendorDirectoryQuery = z.infer<typeof VendorDirectoryQuerySchema>;
export type UploadDocumentRequest = z.infer<typeof UploadDocumentSchema>;
export type RejectDocumentRequest = z.infer<typeof RejectDocumentSchema>;
export type ResolveDocumentsQuery = z.infer<typeof ResolveDocumentsQuerySchema>;
