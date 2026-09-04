import { z } from 'zod';
import { USER_STATUS_VALUES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { PINCODE_PATTERN } from '@core/constants/pincode';
import { ERROR_MESSAGES } from '@core/constants/errors';

export const UpdateUserProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(20).optional().nullable(),
  emailMarketingConsent: z.boolean().optional(),
  /** Phase 2 attach — URL from POST /api/uploads (users/avatar). */
  avatarUrl: z.string().url().optional().nullable(),
});

export const UpdateUserStatusSchema = z.object({
  status: z.enum(USER_STATUS_VALUES),
});

export const GetUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  roleId: z.string().uuid().optional(),
  status: z.enum(USER_STATUS_VALUES).optional(),
  search: z.string().optional(),
});

/** Assignable staff for ticket / bug queues (must hold the requested manage permission). */
export const ListAssigneesQuerySchema = z.object({
  permission: z.enum([PERMISSIONS.TICKET_MANAGE, PERMISSIONS.BUG_REPORT_MANAGE]),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(120).optional(),
  /** When set with TICKET_MANAGE, also include that vendor's owner/staff. */
  vendorId: z.string().uuid().optional(),
});

export const CreateAddressSchema = z.object({
  line1: z.string().min(1).max(255),
  line2: z.string().max(255).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default('India'),
  pincode: z.string().trim().regex(PINCODE_PATTERN, ERROR_MESSAGES.PINCODE_INVALID),
  gstin: z
    .string()
    .trim()
    .max(20)
    .optional()
    .nullable()
    .transform((v) => (v ? v.toUpperCase() : v)),
  isDefault: z.boolean().optional().default(false),
  deliveryInstructions: z.string().trim().max(500).optional().nullable(),
});

export const UpdateAddressSchema = CreateAddressSchema.partial();

export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileSchema>;
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusSchema>;
export type GetUsersQuery = z.infer<typeof GetUsersQuerySchema>;
export type ListAssigneesQuery = z.infer<typeof ListAssigneesQuerySchema>;
export type CreateAddressRequest = z.infer<typeof CreateAddressSchema>;
export type UpdateAddressRequest = z.infer<typeof UpdateAddressSchema>;
