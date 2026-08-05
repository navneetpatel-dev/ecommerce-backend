import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { categoriesService } from './categories.service';
import { CreateCategorySchema, UpdateCategorySchema } from './categories.dto';

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateCategorySchema.parse(req.body);
  const category = await categoriesService.createCategory(dto);
  res.status(201).json(ok(category));
});

export const getCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await categoriesService.getCategories();
  res.json(ok(categories));
});

export const getCategoryById = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoriesService.getCategoryById(req.params.id!);
  res.json(ok(category));
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
