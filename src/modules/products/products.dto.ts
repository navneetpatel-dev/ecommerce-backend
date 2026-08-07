import { z } from 'zod';
import { PRODUCT_STATUS_VALUES } from '@core/constants/statuses';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@core/constants/http';

export const CreateProductSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  basePrice: z.number().positive(),
  tags: z.array(z.string()).default([]),
});

export const UpdateProductSchema = z.object({
  categoryId: z.string().uuid().optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  basePrice: z.number().positive().optional(),
  tags: z.array(z.string()).optional(),
});

export const GetProductsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    categoryId: z.string().uuid().optional(),
    vendorId: z.string().uuid().optional(),
    status: z.enum(PRODUCT_STATUS_VALUES).optional(),
    search: z.string().optional(),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    rating: z.coerce.number().min(1).max(5).optional(),
    sort: z.enum(['trending', 'price_asc', 'price_desc', 'newest', 'rating', 'popular']).optional(),
    includeDescendants: z
      .union([z.literal('true'), z.literal('false'), z.boolean()])
      .optional()
      .transform((value) => value === true || value === 'true'),
  })
  .passthrough();

export const ApproveProductSchema = z.object({});

export const RejectProductSchema = z.object({
  rejectionNote: z.string().min(1),
});

export const AddVariantSchema = z.object({
  sku: z.string().min(1),
  attributes: z.record(z.string()).default({}),
  price: z.number().positive(),
  stock: z.number().int().nonnegative().default(0),
  lowStockAt: z.number().int().nonnegative().default(5),
});

export const UpdateVariantSchema = z.object({
  attributes: z.record(z.string()).optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  lowStockAt: z.number().int().nonnegative().optional(),
});

export const AddImageSchema = z.object({
  url: z.string().url(),
  isPrimary: z.boolean().default(false),
});

export type CreateProductRequest = z.infer<typeof CreateProductSchema>;
export type UpdateProductRequest = z.infer<typeof UpdateProductSchema>;
export type GetProductsQuery = z.infer<typeof GetProductsQuerySchema>;
export type ApproveProductRequest = z.infer<typeof ApproveProductSchema>;
export type RejectProductRequest = z.infer<typeof RejectProductSchema>;
export type AddVariantRequest = z.infer<typeof AddVariantSchema>;
export type UpdateVariantRequest = z.infer<typeof UpdateVariantSchema>;
export type AddImageRequest = z.infer<typeof AddImageSchema>;
