import { z } from 'zod';

export const UpdateUserProfileSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
});

export const UpdateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BLOCKED']),
});

export const GetUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  roleId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
  search: z.string().optional(),
});

export const CreateAddressSchema = z.object({
  line1: z.string().min(1).max(255),
  line2: z.string().max(255).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  country: z.string().min(1).max(100).default('India'),
  pincode: z.string().min(4).max(12),
  isDefault: z.boolean().optional().default(false),
});

export type UpdateUserProfileRequest = z.infer<typeof UpdateUserProfileSchema>;
export type UpdateUserStatusRequest = z.infer<typeof UpdateUserStatusSchema>;
export type GetUsersQuery = z.infer<typeof GetUsersQuerySchema>;
export type CreateAddressRequest = z.infer<typeof CreateAddressSchema>;
