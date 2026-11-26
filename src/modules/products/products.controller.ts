import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ValidationError } from '@core/errors/ValidationError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { BULK_IMPORT_LIMITS } from '@core/constants/product';
import { ROLES } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { userHasPermission } from '@middleware/rbac.middleware';
import { productsService } from './products.service';
import type { ProductActor } from './productChangePolicy';
import { createProductOnBehalf, submitProductOnBehalf } from './productOnBehalf.service';
import {
  addImageAs,
  addVariantAs,
  changeImageAs,
  productIdOfImage,
  updateProductAs,
  updateVariantAs,
} from './productAdminChanges';
import { isCatalogModerator, listsUnpublished } from './productVisibility';
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
  GstPreviewQuerySchema,
  CreateProductOnBehalfSchema,
  SubmitOnBehalfSchema,
  ApproveProductSchema,
} from './products.dto';

/** The GST rate and GST-inclusive price customers see for a pre-GST price (vendor form). */
export const getGstPreview = asyncHandler(async (req: Request, res: Response) => {
  const query = GstPreviewQuerySchema.parse(req.query);
  res.json(ok(await productsService.gstPreview(query.categoryId, query.price)));
});

/**
 * Prices, tax codes and variants belong to the store owner (product.create). A platform product admin
 * (product.manage) may change them only as `productChangePolicy` allows; vendor staff never.
 */
async function productActor(req: Request): Promise<ProductActor> {
  const [canManage, canCreate, canPrice] = await Promise.all([
    userHasPermission(req.user, PERMISSIONS.PRODUCT_MANAGE),
    userHasPermission(req.user, PERMISSIONS.PRODUCT_CREATE),
    userHasPermission(req.user, PERMISSIONS.PRODUCT_PRICING),
  ]);
  return { id: req.user!.id, vendorId: req.user!.vendorId ?? null, canManage, canCreate, canPrice };
}

const isSuperAdmin = (req: Request) => req.user?.role.name === ROLES.SUPER_ADMIN;

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateProductSchema.parse(req.body);
  const product = await productsService.createProduct(req.user!.vendorId, dto, { actorId: req.user!.id });
  res.status(201).json(ok(product));
});

/** A platform admin lists a product for an approved vendor (a draft the vendor can edit and submit). */
export const createProductForVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateProductOnBehalfSchema.parse(req.body);
  res.status(201).json(ok(await createProductOnBehalf(req.user!.id, dto, isSuperAdmin(req))));
});

/** A platform admin submits a product it listed, recording the vendor's agreement. */
export const submitForVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = SubmitOnBehalfSchema.parse(req.body);
  res.json(ok(await submitProductOnBehalf(req.user!.id, req.params.id!, dto.consentNote)));
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
  'inStock',
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
    customerFacing: !(await listsUnpublished(req.user, query.vendorId ?? undefined)),
    includeDescendants: Boolean(query.includeDescendants),
    attributeFilters: extractAttributeFilters(req.query),
  });
  res.json(ok(result.products, { pagination: result.pagination }));
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductById(req.params.id!, {
    customerFacing: !(await isCatalogModerator(req.user)),
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
    customerFacing: !(await isCatalogModerator(req.user)),
  });
  res.json(ok(product));
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateProductSchema.parse(req.body);
  res.json(ok(await updateProductAs(await productActor(req), req.params.id!, dto)));
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteProduct(req.params.id!, req.user!.vendorId);
  res.status(204).send();
});

export const submitForApproval = asyncHandler(async (req: Request, res: Response) => {
  // The platform's own products have no vendor: a Super Admin publishes them directly.
  const platformOwned = !req.user!.vendorId && isSuperAdmin(req);
  const product = await productsService.submitForApproval(req.params.id!, req.user!.vendorId ?? null, req.user!.id, platformOwned);
  res.json(ok(product));
});

export const approveProduct = asyncHandler(async (req: Request, res: Response) => {
  const { ownWorkReason } = ApproveProductSchema.parse(req.body ?? {});
  // Only a Super Admin may approve their own work (with a reason); for anyone else the reason is ignored.
  const product = await productsService.approveProduct(
    req.params.id!,
    req.user!.id,
    req.user!.vendorId,
    isSuperAdmin(req) ? ownWorkReason : undefined,
  );
  res.json(ok(product));
});

export const rejectProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = RejectProductSchema.parse(req.body);
  const product = await productsService.rejectProduct(req.params.id!, dto, req.user!.id);
  res.json(ok(product));
});

export const archiveProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.archiveProduct(req.params.id!, req.user!.id);
  res.json(ok(product));
});

export const unarchiveProduct = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.unarchiveProduct(req.params.id!, req.user!.id);
  res.json(ok(product));
});

// variants
export const addVariant = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddVariantSchema.parse(req.body);
  res.status(201).json(ok(await addVariantAs(await productActor(req), req.params.id!, dto)));
});

export const updateVariant = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateVariantSchema.parse(req.body);
  res.json(ok(await updateVariantAs(await productActor(req), req.params.variantId!, dto)));
});

export const deleteVariant = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteVariant(req.params.variantId!);
  res.status(204).send();
});

// Images
export const addImage = asyncHandler(async (req: Request, res: Response) => {
  const dto = AddImageSchema.parse(req.body);
  res.status(201).json(ok(await addImageAs(await productActor(req), req.params.id!, dto)));
});

export const deleteImage = asyncHandler(async (req: Request, res: Response) => {
  const imageId = req.params.imageId!;
  await changeImageAs(await productActor(req), await productIdOfImage(imageId), 'images', () => productsService.deleteImage(imageId));
  res.status(204).send();
});

export const replaceImage = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReplaceImageSchema.parse(req.body);
  const imageId = req.params.imageId!;
  const image = await changeImageAs(await productActor(req), await productIdOfImage(imageId), 'images', () => productsService.replaceImage(imageId, dto));
  res.json(ok(image));
});

export const setPrimaryImage = asyncHandler(async (req: Request, res: Response) => {
  const imageId = req.params.imageId!;
  const image = await changeImageAs(await productActor(req), await productIdOfImage(imageId), 'primary image', () => productsService.setPrimaryImage(imageId));
  res.json(ok(image));
});
