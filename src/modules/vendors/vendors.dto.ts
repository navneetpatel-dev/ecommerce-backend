import { z } from 'zod';

export const RegisterVendorSchema = z.object({
  businessName: z.string().min(1),
  gstNumber: z.string().optional(),
  bankDetails: z.record(z.unknown()),
  description: z.string().optional(),
});

export const UpdateVendorSchema = z.object({
  businessName: z.string().min(1).optional(),
  gstNumber: z.string().optional(),
  bankDetails: z.record(z.unknown()).optional(),
  description: z.string().optional(),
  logoUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
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
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  search: z.string().optional(),
});

export const UploadDocumentSchema = z.object({
  type: z.enum(['GST_CERT', 'PAN', 'BANK_PROOF']),
  url: z.string().url(),
});

export type RegisterVendorRequest = z.infer<typeof RegisterVendorSchema>;
export type UpdateVendorRequest = z.infer<typeof UpdateVendorSchema>;
export type ApproveVendorRequest = z.infer<typeof ApproveVendorSchema>;
export type RejectVendorRequest = z.infer<typeof RejectVendorSchema>;
export type SuspendVendorRequest = z.infer<typeof SuspendVendorSchema>;
export type GetVendorsQuery = z.infer<typeof GetVendorsQuerySchema>;
export type UploadDocumentRequest = z.infer<typeof UploadDocumentSchema>;
