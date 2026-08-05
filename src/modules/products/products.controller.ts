import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { productsService } from './products.service';
import {
  CreateProductSchema,
  UpdateProductSchema,
  GetProductsQuerySchema,
  RejectProductSchema,
  AddVariantSchema,
  UpdateVariantSchema,
  AddImageSchema,
} from './products.dto';

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const dto = CreateProductSchema.parse(req.body);
  const product = await productsService.createProduct(req.user!.vendorId, dto);
  res.status(201).json(ok(product));
});

export const getProducts = asyncHandler(async (req: Request, res: Response) => {
  const query = GetProductsQuerySchema.parse(req.query);
  const result = await productsService.getProducts(query);
  res.json(ok(result.products, { pagination: result.pagination }));
});

export const getProductById = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductById(req.params.id!);
  res.json(ok(product));
});

export const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductBySlug(req.params.slug!);
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

export const setPrimaryImage = asyncHandler(async (req: Request, res: Response) => {
  const image = await productsService.setPrimaryImage(req.params.imageId!);
  res.json(ok(image));
});
