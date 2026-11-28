import { z } from 'zod';
import {
  CATEGORY_ATTRIBUTE_TYPE_VALUES,
  CATEGORY_STATUS_VALUES,
  WARRANTY_TYPE_VALUES,
} from '@core/constants/statuses';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { ADMIN_NOTE_LIMITS } from '@core/constants/product';

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

const optionalReturnWindowDays = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(0).max(365).nullable().optional(),
);

const optionalWarrantyMonths = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().min(0).max(120).nullable().optional(),
);

const optionalWarrantyType = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.enum(WARRANTY_TYPE_VALUES).nullable().optional(),
);

/** Why GST or commission on vendor products is being changed by a move (see `categoryChangeGate`). */
const changeReason = z.string().trim().min(ADMIN_NOTE_LIMITS.MIN).max(ADMIN_NOTE_LIMITS.MAX).optional();

/** The move or reassignment whose effect on rates is being asked about. */
export const RateImpactQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reassign'), fromCategoryId: z.string().uuid(), toCategoryId: z.string().uuid() }),
  z.object({ kind: z.literal('reparent'), categoryId: z.string().uuid(), parentId: z.string().uuid().optional() }),
]);

/** Category and attribute name limits. Keep in sync with the web category form. */
export const CATEGORY_NAME_MAX = 100;
export const ATTRIBUTE_NAME_MAX = 60;
export const ATTRIBUTE_OPTIONS_MAX = 50;
export const ATTRIBUTE_OPTION_TEXT_MAX = 100;

const categoryName = z.string().trim().min(1).max(CATEGORY_NAME_MAX);
const attributeOptions = z
  .array(
    z.union([
      z.string().trim().max(ATTRIBUTE_OPTION_TEXT_MAX),
      z.number(),
      z.boolean(),
      z.record(z.string(), z.any()),
    ]),
  )
  .max(ATTRIBUTE_OPTIONS_MAX);

export const CreateCategorySchema = z.object({
  name: categoryName,
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
  displayOrder: z.coerce.number().int().optional(),
  seoTitle: optionalSeo,
  seoDescription: optionalSeoDescription,
  commissionRate: optionalCommissionRate,
  returnWindowDays: optionalReturnWindowDays,
  codEnabled: z.boolean().optional(),
  defaultWarrantyMonths: optionalWarrantyMonths,
  defaultWarrantyType: optionalWarrantyType,
});

export const UpdateCategorySchema = z.object({
  name: categoryName.optional(),
  /** Rename also changes the URL slug (the link shoppers use); off by default so links keep working. */
  regenerateSlug: z.boolean().optional(),
  /** Archiving a category with active subcategories needs this: it archives them too. */
  cascade: z.boolean().optional(),
  changeReason,
  parentId: optionalParentId,
  imageUrl: optionalImageUrl,
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
  displayOrder: z.coerce.number().int().optional(),
  seoTitle: optionalSeo,
  seoDescription: optionalSeoDescription,
  commissionRate: optionalCommissionRate,
  returnWindowDays: optionalReturnWindowDays,
  codEnabled: z.boolean().optional(),
  defaultWarrantyMonths: optionalWarrantyMonths,
  defaultWarrantyType: optionalWarrantyType,
});

/** The product form's category picker: one page of the tree (or of a search), or one category by id. */
export const CategoryPickerQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(25),
  search: z.string().trim().max(100).optional(),
  id: z.string().uuid().optional(),
});

/** The admin list: the whole tree in order, a page at a time, any status. */
export const AdminCategoriesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.enum(CATEGORY_STATUS_VALUES).optional(),
  /** Leave one category and its descendants out (the parent picker of that category). */
  excludeId: z.string().uuid().optional(),
});

/** Move a category: under another parent and/or before or after a sibling (at most one anchor). */
export const MoveCategorySchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    beforeId: z.string().uuid().optional(),
    afterId: z.string().uuid().optional(),
    changeReason,
  })
  .refine((value) => !(value.beforeId && value.afterId), { message: 'Give beforeId or afterId, not both' });

export const ReorderCategoriesSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
});

export const ReassignProductsSchema = z.object({
  fromCategoryId: z.string().uuid(),
  toCategoryId: z.string().uuid(),
  changeReason,
});

export const CreateCategoryAttributeSchema = z.object({
  name: z.string().trim().min(1).max(ATTRIBUTE_NAME_MAX),
  type: z.enum(CATEGORY_ATTRIBUTE_TYPE_VALUES),
  options: attributeOptions.default([]),
  displayOrder: z.coerce.number().int().optional(),
});

export const UpdateCategoryAttributeSchema = z.object({
  name: z.string().trim().min(1).max(ATTRIBUTE_NAME_MAX).optional(),
  type: z.enum(CATEGORY_ATTRIBUTE_TYPE_VALUES).optional(),
  options: attributeOptions.optional(),
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
