import { z } from 'zod';
import { CATEGORY_STATUS_VALUES } from '@core/constants/statuses';

const optionalImageUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().url().nullable().optional(),
);

const optionalParentId = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().uuid().nullable().optional(),
);

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
});

export type CreateCategoryRequest = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryRequest = z.infer<typeof UpdateCategorySchema>;
