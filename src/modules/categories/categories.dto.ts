import { z } from 'zod';
import {
  CATEGORY_ATTRIBUTE_TYPE_VALUES,
  CATEGORY_STATUS_VALUES,
} from '@core/constants/statuses';
import { pageLimitQuerySchema } from '@core/http/pagination';

const optionalImageUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().url().nullable().optional(),
);

const optionalParentId = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().uuid().nullable().optional(),
);

const optionalSeo = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(255).nullable().optional(),
);

const optionalSeoDescription = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(2000).nullable().optional(),
);

const optionalCommissionRate = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().min(0).max(100).nullable().optional(),
);

export const CreateCategorySchema = z.object({
  name: z.string().min(1),
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
  displayOrder: z.coerce.number().int().optional(),
  seoTitle: optionalSeo,
  seoDescription: optionalSeoDescription,
  commissionRate: optionalCommissionRate,
});

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
  displayOrder: z.coerce.number().int().optional(),
  seoTitle: optionalSeo,
  seoDescription: optionalSeoDescription,
  commissionRate: optionalCommissionRate,
});

export const ReorderCategoriesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export const ReassignProductsSchema = z.object({
  fromCategoryId: z.string().uuid(),
  toCategoryId: z.string().uuid(),
});

export const CreateCategoryAttributeSchema = z.object({
  name: z.string().min(1),
  type: z.enum(CATEGORY_ATTRIBUTE_TYPE_VALUES),
  options: z.array(z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.any())])).default([]),
  displayOrder: z.coerce.number().int().optional(),
});

export const UpdateCategoryAttributeSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(CATEGORY_ATTRIBUTE_TYPE_VALUES).optional(),
  options: z.array(z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.any())])).optional(),
  displayOrder: z.coerce.number().int().optional(),
});

export const ReorderAttributesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export const GetCategoriesPaginatedQuerySchema = pageLimitQuerySchema.extend({
  search: z.string().trim().optional(),
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
});

export type CreateCategoryRequest = z.infer<typeof CreateCategorySchema>;
export type UpdateCategoryRequest = z.infer<typeof UpdateCategorySchema>;
export type CreateCategoryAttributeRequest = z.infer<typeof CreateCategoryAttributeSchema>;
export type UpdateCategoryAttributeRequest = z.infer<typeof UpdateCategoryAttributeSchema>;
export type GetCategoriesPaginatedQuery = z.infer<typeof GetCategoriesPaginatedQuerySchema>;
