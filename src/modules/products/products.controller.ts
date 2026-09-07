import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { BULK_IMPORT_LIMITS } from '@core/constants/product';
import { productsService } from './products.service';
import { ADMIN_ROLES, ROLES } from '@core/constants/statuses';
import { parseProductsCsv } from './products.csv';
import {
  CreateProductSchema,
  UpdateProductSchema,
  GetProductsQuerySchema,
  RejectProductSchema,
  AddVariantSchema,
  UpdateVariantSchema,
  AddImageSchema,
  ReplaceImageSchema,
  TrackRecentlyViewedSchema,
} from './products.dto';

/** Admin/vendor dashboards stay unscoped; shoppers use customerVisible. */
function isCatalogModerator(req: Request): boolean {
  const role = req.user?.role?.name;
  if (!role) return false;
  return (
    (ADMIN_ROLES as readonly string[]).includes(role) ||
    role === ROLES.VENDOR_OWNER ||
    role === ROLES.VENDOR_STAFF
  );
}

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateProductSchema.parse(req.body);
  const product = await productsService.createProduct(req.user!.vendorId, dto);
  res.status(201).json(ok(product));
});

export const bulkImportProducts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED);
  }
  if (!req.file || req.file.buffer.length === 0) {
    throw new ValidationError(ERROR_MESSAGES.PRODUCT_BULK_IMPORT_FILE_REQUIRED);
  }

  const text = req.file.buffer.toString('utf-8');
  const rows = parseProductsCsv(text);

  if (rows.length === 0) {
    throw new ValidationError(ERROR_MESSAGES.PRODUCT_BULK_IMPORT_EMPTY);
  }
  if (rows.length > BULK_IMPORT_LIMITS.MAX_ROWS) {
    throw new ValidationError(ERROR_MESSAGES.PRODUCT_BULK_IMPORT_TOO_MANY_ROWS);
  }

  const results = await productsService.bulkImportProducts(req.user!.vendorId, rows);
  res.status(200).json(ok(results));
});

const PRODUCT_LIST_QUERY_KEYS = new Set([
  'page',
  'limit',
  'categoryId',
  'vendorId',
  'status',
  'search',
  'minPrice',
  'maxPrice',
  'rating',
  'sort',
  'includeDescendants',
  'excludeProductId',
]);

function extractAttributeFilters(query: Request['query']): Record<string, string[]> {
  const selected: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (PRODUCT_LIST_QUERY_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.length) {
      selected[key] = value.split(',').map((part) => part.trim()).filter(Boolean);
    } else if (Array.isArray(value)) {
      selected[key] = value
        .flatMap((part) => String(part).split(','))
        .map((part) => part.trim())
        .filter(Boolean);
    }
  }
  return selected;
}

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = GetProductsQuerySchema.parse(req.query);
  const result = await productsService.getProducts(query, {
    customerFacing: !isCatalogModerator(req),
    includeDescendants: Boolean(query.includeDescendants),
    attributeFilters: extractAttributeFilters(req.query),
  });
  res.json(ok(result.products, { pagination: result.pagination }));
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductById(req.params.id!, {
    customerFacing: !isCatalogModerator(req),
  });
  res.json(ok(product));
});

export const trackRecentlyViewed = asyncHandler(async (req: Request, res: Response) => {
  const dto = TrackRecentlyViewedSchema.parse(req.body);
  await productsService.trackRecentlyViewed(req.user!.id, dto.productId);
  res.status(204).send();
});

export const getRecentlyViewed = asyncHandler(async (req: Request, res: Response) => {
  const products = await productsService.getRecentlyViewedProducts(req.user!.id);
  res.json(ok(products));
});

export const getFrequentlyBoughtTogether = asyncHandler(async (req: Request, res: Response) => {
  const products = await productsService.getFrequentlyBoughtTogether(req.params.id!);
  res.json(ok(products));
});

export const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductBySlug(req.params.slug!, {
    customerFacing: !isCatalogModerator(req),
  });
  res.json(ok(product));
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateProductSchema.parse(req.body);
  const product = await productsService.updateProduct(req.params.id!, req.user!.vendorId, dto);
  res.json(ok(product));
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteProduct(req.params.id!, req.user!.vendorId);
  res.status(204).send();
});

export const submitForApproval = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.submitForApproval(req.params.id!, req.user!.vendorId!);
  res.json(ok(product));
});

export const approveProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.approveProduct(req.params.id!, req.user!.id);
  res.json(ok(product));
});

export const rejectProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = RejectProductSchema.parse(req.body);
  const product = await productsService.rejectProduct(req.params.id!, dto);
  res.json(ok(product));
});

export const archiveProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.archiveProduct(req.params.id!);
  res.json(ok(product));
});

// variants
export const addVariant = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddVariantSchema.parse(req.body);
  const variant = await productsService.addVariant(req.params.id!, dto);
  res.status(201).json(ok(variant));
});

export const updateVariant = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateVariantSchema.parse(req.body);
  const variant = await productsService.updateVariant(req.params.variantId!, dto);
  res.json(ok(variant));
});

export const deleteVariant = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteVariant(req.params.variantId!);
  res.status(204).send();
});

// Images
export const addImage = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddImageSchema.parse(req.body);
  const image = await productsService.addImage(req.params.id!, dto);
  res.status(201).json(ok(image));
});

export const deleteImage = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteImage(req.params.imageId!);
  res.status(204).send();
});

export const replaceImage = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReplaceImageSchema.parse(req.body);
  const image = await productsService.replaceImage(req.params.imageId!, dto);
  res.json(ok(image));
});

export const setPrimaryImage = asyncHandler(async (req: Request, res: Response) => {
  const image = await productsService.setPrimaryImage(req.params.imageId!);
  res.json(ok(image));
});
