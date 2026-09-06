import { z } from 'zod';
import { PRODUCT_STATUS_VALUES, WARRANTY_TYPE_VALUES } from '@core/constants/statuses';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '@core/constants/http';
import { PRODUCT_FIELD_LIMITS } from '@core/constants/product';
import { ERROR_MESSAGES } from '@core/constants/errors';

const emptyToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;

const optionalNullableText = (max: number) =>
  z.preprocess(emptyToNull, z.string().max(max).nullable().optional());

const optionalNullableUrl = (max: number) =>
  z.preprocess(emptyToNull, z.string().url().max(max).nullable().optional());

const stringList = (itemMax: number, listMax: number, required: boolean) => {
  const item = z.string().trim().min(1).max(itemMax);
  const list = z.array(item).max(listMax);
  return required ? list.default([]) : list.optional();
};

const specsSchema = (required: boolean) => {
  const record = z
    .record(z.string().trim().min(1).max(PRODUCT_FIELD_LIMITS.SPEC_VALUE_MAX))
    .superRefine((value, ctx) => {
      const keys = Object.keys(value);
      if (keys.length > PRODUCT_FIELD_LIMITS.SPECS_MAX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: ERROR_MESSAGES.PRODUCT_SPECS_TOO_MANY,
        });
      }
      const seen = new Set<string>();
      for (const key of keys) {
        const trimmed = key.trim();
        if (!trimmed || trimmed.length > PRODUCT_FIELD_LIMITS.SPEC_KEY_MAX) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: ERROR_MESSAGES.PRODUCT_SPEC_KEY_INVALID,
          });
        }
        const normalized = trimmed.toLowerCase();
        if (seen.has(normalized)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: ERROR_MESSAGES.PRODUCT_SPEC_DUPLICATE_KEY,
          });
        }
        seen.add(normalized);
      }
    });
  return required ? record.default({}) : record.optional();
};

function assertCompareAtPrice(data: { basePrice?: number; compareAtPrice?: number | null }, ctx: z.RefinementCtx) {
  if (data.compareAtPrice == null || data.basePrice == null) return;
  if (Number(data.compareAtPrice) < Number(data.basePrice)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['compareAtPrice'],
      message: ERROR_MESSAGES.PRODUCT_COMPARE_AT_BELOW_PRICE,
    });
  }
}

export const CreateProductSchema = z
  .object({
    categoryId: z.string().uuid(),
    /** Optional secondary tags (ProductCategory); canonical categoryId stays primary. */
    secondaryCategoryIds: z.array(z.string().uuid()).max(20).default([]),
    name: z.string().trim().min(1).max(PRODUCT_FIELD_LIMITS.NAME_MAX),
    description: z.string().trim().min(1).max(PRODUCT_FIELD_LIMITS.DESCRIPTION_MAX),
    basePrice: z.number().positive(),
    compareAtPrice: z.number().positive().nullable().optional(),
    brand: optionalNullableText(PRODUCT_FIELD_LIMITS.BRAND_MAX),
    tags: stringList(PRODUCT_FIELD_LIMITS.TAG_MAX, PRODUCT_FIELD_LIMITS.TAGS_MAX, true),
    highlights: stringList(PRODUCT_FIELD_LIMITS.HIGHLIGHT_MAX, PRODUCT_FIELD_LIMITS.HIGHLIGHTS_MAX, true),
    specs: specsSchema(true),
    deliveryNote: optionalNullableText(PRODUCT_FIELD_LIMITS.NOTE_MAX),
    returnNote: optionalNullableText(PRODUCT_FIELD_LIMITS.NOTE_MAX),
    warrantyMonths: z.number().int().min(0).max(PRODUCT_FIELD_LIMITS.WARRANTY_MONTHS_MAX).nullable().optional(),
    warrantyType: z.enum(WARRANTY_TYPE_VALUES).nullable().optional(),
    hsnCode: optionalNullableText(PRODUCT_FIELD_LIMITS.HSN_MAX),
    seoTitle: optionalNullableText(PRODUCT_FIELD_LIMITS.SEO_TITLE_MAX),
    seoDescription: optionalNullableText(PRODUCT_FIELD_LIMITS.SEO_DESCRIPTION_MAX),
    videoUrl: optionalNullableUrl(2048),
    sizeChartUrl: optionalNullableUrl(2048),
    codEnabled: z.boolean().nullable().optional(),
  })
  .superRefine(assertCompareAtPrice);

export const UpdateProductSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    secondaryCategoryIds: z.array(z.string().uuid()).max(20).optional(),
    name: z.string().trim().min(1).max(PRODUCT_FIELD_LIMITS.NAME_MAX).optional(),
    description: z.string().trim().min(1).max(PRODUCT_FIELD_LIMITS.DESCRIPTION_MAX).optional(),
    basePrice: z.number().positive().optional(),
    compareAtPrice: z.number().positive().nullable().optional(),
    brand: optionalNullableText(PRODUCT_FIELD_LIMITS.BRAND_MAX),
    tags: stringList(PRODUCT_FIELD_LIMITS.TAG_MAX, PRODUCT_FIELD_LIMITS.TAGS_MAX, false),
    highlights: stringList(PRODUCT_FIELD_LIMITS.HIGHLIGHT_MAX, PRODUCT_FIELD_LIMITS.HIGHLIGHTS_MAX, false),
    specs: specsSchema(false),
    deliveryNote: optionalNullableText(PRODUCT_FIELD_LIMITS.NOTE_MAX),
    returnNote: optionalNullableText(PRODUCT_FIELD_LIMITS.NOTE_MAX),
    warrantyMonths: z.number().int().min(0).max(PRODUCT_FIELD_LIMITS.WARRANTY_MONTHS_MAX).nullable().optional(),
    warrantyType: z.enum(WARRANTY_TYPE_VALUES).nullable().optional(),
    hsnCode: optionalNullableText(PRODUCT_FIELD_LIMITS.HSN_MAX),
    seoTitle: optionalNullableText(PRODUCT_FIELD_LIMITS.SEO_TITLE_MAX),
    seoDescription: optionalNullableText(PRODUCT_FIELD_LIMITS.SEO_DESCRIPTION_MAX),
    videoUrl: optionalNullableUrl(2048),
    sizeChartUrl: optionalNullableUrl(2048),
    codEnabled: z.boolean().nullable().optional(),
  })
  .superRefine(assertCompareAtPrice);

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
    excludeProductId: z.string().uuid().optional(),
  })
  .passthrough();

export const TrackRecentlyViewedSchema = z.object({
  productId: z.string().uuid(),
});

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
  weightGrams: z.number().int().positive().optional(),
});

export const UpdateVariantSchema = z.object({
  attributes: z.record(z.string()).optional(),
  price: z.number().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  lowStockAt: z.number().int().nonnegative().optional(),
  weightGrams: z.number().int().positive().optional(),
});

export const AddImageSchema = z.object({
  url: z.string().url(),
  isPrimary: z.boolean().default(false),
  variantId: z.string().uuid().nullable().optional(),
});

export const ReplaceImageSchema = z.object({
  url: z.string().url(),
  isPrimary: z.boolean().optional(),
});

export type TrackRecentlyViewedRequest = z.infer<typeof TrackRecentlyViewedSchema>;

/** Per-row outcome for POST /products/bulk-import. */
export interface BulkImportRowResult {
  row: number;
  success: boolean;
  productId?: string;
  error?: string;
}

export type CreateProductRequest = z.infer<typeof CreateProductSchema>;
export type UpdateProductRequest = z.infer<typeof UpdateProductSchema>;
export type GetProductsQuery = z.infer<typeof GetProductsQuerySchema>;
export type ApproveProductRequest = z.infer<typeof ApproveProductSchema>;
export type RejectProductRequest = z.infer<typeof RejectProductSchema>;
export type AddVariantRequest = z.infer<typeof AddVariantSchema>;
export type UpdateVariantRequest = z.infer<typeof UpdateVariantSchema>;
export type AddImageRequest = z.infer<typeof AddImageSchema>;
export type ReplaceImageRequest = z.infer<typeof ReplaceImageSchema>;
