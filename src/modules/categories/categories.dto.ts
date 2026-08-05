import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().optional(),
});

export type CreateCategoryRequest = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryRequest = z.infer<typeof UpdateCategorySchema>;
