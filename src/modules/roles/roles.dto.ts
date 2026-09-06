import { z } from 'zod';

export const CreateRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Role names use SCREAMING_SNAKE_CASE, e.g. SUPPORT_AUDITOR'),
});

export const UpdateRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Role names use SCREAMING_SNAKE_CASE, e.g. SUPPORT_AUDITOR'),
});

export const SetRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string()),
});

export type CreateRoleRequest = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleRequest = z.infer<typeof UpdateRoleSchema>;
export type SetRolePermissionsRequest = z.infer<typeof SetRolePermissionsSchema>;
