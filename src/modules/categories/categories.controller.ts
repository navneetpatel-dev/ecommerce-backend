import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { categoriesService } from './categories.service';
import {
  CreateCategoryAttributeSchema,
  CreateCategorySchema,
  GetCategoriesPaginatedQuerySchema,
  ReassignProductsSchema,
  ReorderAttributesSchema,
  ReorderCategoriesSchema,
  UpdateCategoryAttributeSchema,
  UpdateCategorySchema,
} from './categories.dto';

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCategorySchema.parse(req.body);
  const category = await categoriesService.createCategory(dto);
  res.status(201).json(ok(category));
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
  const category = await categoriesService.getCategoryById(req.params.id!);
  res.json(ok(category));
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

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCategorySchema.parse(req.body);
  const category = await categoriesService.updateCategory(req.params.id!, dto);
  res.json(ok(category));
});

export const reorderCategories = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReorderCategoriesSchema.parse(req.body);
  const result = await categoriesService.reorderCategories(dto.orderedIds);
  res.json(ok(result));
});

export const reassignProducts = asyncHandler(async (req: Request, res: Response) => {
  const dto = ReassignProductsSchema.parse(req.body);
  const result = await categoriesService.reassignProducts(dto.fromCategoryId, dto.toCategoryId);
  res.json(ok(result));
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.deleteCategory(req.params.id!);
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
