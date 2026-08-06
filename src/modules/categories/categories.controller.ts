import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { categoriesService } from './categories.service';
import { CreateCategorySchema, UpdateCategorySchema } from './categories.dto';

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCategorySchema.parse(req.body);
  const category = await categoriesService.createCategory(dto);
  res.status(201).json(ok(category));
});

export const getCategories = asyncHandler(async (req: Request, res: Response) => {
  // Storefront / vendor pickers omit page → full tree. Admin list passes page/limit.
  if (req.query.page != null || req.query.limit != null) {
    const query = pageLimitQuerySchema.parse(req.query);
    const result = await categoriesService.getCategoriesPaginated(query);
    res.json(ok(result.categories, { pagination: result.pagination }));
    return;
  }
  const categories = await categoriesService.getCategories();
  res.json(ok(categories));
});

export const getCategoryById = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoriesService.getCategoryById(req.params.id!);
  res.json(ok(category));
});

export const getCategoryProductCount = asyncHandler(async (req: Request, res: Response) => {
  const result = await categoriesService.getProductCount(req.params.id!);
  res.json(ok(result));
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateCategorySchema.parse(req.body);
  const category = await categoriesService.updateCategory(req.params.id!, dto);
  res.json(ok(category));
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.deleteCategory(req.params.id!);
  res.status(204).send();
});
