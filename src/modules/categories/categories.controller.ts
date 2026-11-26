import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { categoriesService } from './categories.service';
import { logAudit } from '@modules/audit/audit.service';
import { getCategoryImpact, listCategoriesForAdmin } from './categoryAdmin';
import { moveCategory } from './categoryMove';
import { listCategoriesForPicker } from './categoryPicker';
import {
  AdminCategoriesQuerySchema,
  CategoryPickerQuerySchema,
  MoveCategorySchema,
  CreateCategoryAttributeSchema,
  CreateCategorySchema,
  GetCategoriesPaginatedQuerySchema,
  ReassignProductsSchema,
  ReorderAttributesSchema,
  ReorderCategoriesSchema,
  UpdateCategoryAttributeSchema,
  UpdateCategorySchema,
} from './categories.dto';

/** Every category change is recorded under the admin who made it. */
function auditCategory(req: Request, action: string, entityId: string, metadata: Record<string, unknown>) {
  return logAudit({ actorId: req.user!.id, action, entityType: 'Category', entityId, metadata });
}

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCategorySchema.parse(req.body);
  const category = await categoriesService.createCategory(dto);
  await auditCategory(req, 'CATEGORY_CREATED', category.id, { name: category.name, parentId: dto.parentId ?? null });
  res.status(201).json(ok(category));
});

/** Categories for the product form's picker: a page at a time, with each one's GST. */
export const getCategoryPicker = asyncHandler(async (req: Request, res: Response) => {
  const query = CategoryPickerQuerySchema.parse(req.query);
  const result = await listCategoriesForPicker(query);
  res.json(ok(result.categories, { pagination: result.pagination }));
});

export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  if (req.query.page != null || req.query.limit != null) {
    const query = GetCategoriesPaginatedQuerySchema.parse(req.query);
    const result = await categoriesService.getCategoriesPaginated(query);
    res.json(ok(result.categories, { pagination: result.pagination }));
    return;
  }
  const categories = await categoriesService.getCategories();
  res.json(ok(categories));
});

export const resolveCategoryPath = asyncHandler(async (req: Request, res: Response) => {
  const path = String(req.query.path ?? '')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const category = await categoriesService.resolveByPath(path);
  res.json(ok(category));
});

export const getCategoryById = asyncHandler(async (req: Request, res: Response) => {
  // Public: active categories only, without the platform's internal fields.
  const category = await categoriesService.getCategoryById(req.params.id!, { publicView: true });
  res.json(ok(category));
});

/** The admin screens: every status, a page of the tree at a time, with products, children and GST. */
export const getAdminCategories = asyncHandler(async (req: Request, res: Response) => {
  const query = AdminCategoriesQuerySchema.parse(req.query);
  const result = await listCategoriesForAdmin(query);
  res.json(ok(result.categories, { pagination: result.pagination }));
});

export const getAdminCategory = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await categoriesService.getCategoryById(req.params.id!)));
});

/** What archiving or deleting a category would touch, shown before the admin confirms. */
export const getCategoryImpactHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(ok(await getCategoryImpact(req.params.id!)));
});

export const moveCategoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const dto = MoveCategorySchema.parse(req.body);
  const result = await moveCategory(req.params.id!, dto);
  await auditCategory(req, 'CATEGORY_MOVED', req.params.id!, { parentId: result.parentId, reparented: result.reparented, ...dto });
  if (result.reparented) refreshDisplayPricesAfterCategoryChange('category moved');
  res.json(ok(result));
});

export const getCategoryProductCount = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoriesService.getProductCount(req.params.id!);
  res.json(ok(result));
});

export const getCategoryFacets = asyncHandler(async (req: Request, res: Response) => {
  const selected: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || key === 'page' || key === 'limit' || key === 'sort') continue;
    if (typeof value === 'string' && value.length) {
      selected[key] = value.split(',').map((part) => part.trim()).filter(Boolean);
    } else if (Array.isArray(value)) {
      selected[key] = value.flatMap((part) => String(part).split(',')).map((p) => p.trim()).filter(Boolean);
    }
  }
  const result = await categoriesService.getFacets(req.params.idOrSlug!, selected);
  res.json(ok(result));
});

/** Products' GST-inclusive prices follow their category's tax rule, so recompute them. */
function refreshDisplayPricesAfterCategoryChange(trigger: string): void {
  void import('@modules/products/products.service').then(({ refreshAllProductDisplayPricesInBackground }) =>
    refreshAllProductDisplayPricesInBackground(trigger),
  );
}

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCategorySchema.parse(req.body);
  const category = await categoriesService.updateCategory(req.params.id!, dto);
  // A moved category can fall under another ancestor's tax rule.
  if (dto.parentId !== undefined) refreshDisplayPricesAfterCategoryChange('category moved');
  const { status, cascade, regenerateSlug: _regenerate, ...rest } = dto;
  const action = status === 'ARCHIVED' ? 'CATEGORY_ARCHIVED' : status === 'ACTIVE' && !Object.keys(rest).length ? 'CATEGORY_REACTIVATED' : 'CATEGORY_UPDATED';
  await auditCategory(req, action, req.params.id!, { changedFields: Object.keys(dto), cascade: Boolean(cascade) });
  res.json(ok(category));
});

export const reorderCategories = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReorderCategoriesSchema.parse(req.body);
  const result = await categoriesService.reorderCategories(dto.orderedIds);
  await auditCategory(req, 'CATEGORIES_REORDERED', dto.orderedIds[0]!, { orderedIds: dto.orderedIds });
  res.json(ok(result));
});

export const reassignProducts = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReassignProductsSchema.parse(req.body);
  const result = await categoriesService.reassignProducts(dto.fromCategoryId, dto.toCategoryId);
  await auditCategory(req, 'CATEGORY_PRODUCTS_REASSIGNED', dto.fromCategoryId, { ...dto, updatedCount: result.updatedCount });
  refreshDisplayPricesAfterCategoryChange('products reassigned');
  res.json(ok(result));
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const existing = await categoriesService.getCategoryById(req.params.id!);
  await categoriesService.deleteCategory(req.params.id!, req.user!.id);
  await auditCategory(req, 'CATEGORY_DELETED', req.params.id!, { name: existing.name, slug: existing.slug });
  res.status(204).send();
});

export const listAttributes = asyncHandler(async (req: Request, res: Response) => {
  const rows = await categoriesService.listAttributes(req.params.categoryId!);
  res.json(ok(rows));
});

export const createAttribute = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCategoryAttributeSchema.parse(req.body);
  const row = await categoriesService.createAttribute(req.params.categoryId!, dto);
  res.status(201).json(ok(row));
});

export const updateAttribute = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCategoryAttributeSchema.parse(req.body);
  const row = await categoriesService.updateAttribute(
    req.params.categoryId!,
    req.params.attributeId!,
    dto,
  );
  res.json(ok(row));
});

export const reorderAttributes = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReorderAttributesSchema.parse(req.body);
  const result = await categoriesService.reorderAttributes(req.params.categoryId!, dto.orderedIds);
  res.json(ok(result));
});

export const deleteAttribute = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.deleteAttribute(req.params.categoryId!, req.params.attributeId!);
  res.status(204).send();
});
