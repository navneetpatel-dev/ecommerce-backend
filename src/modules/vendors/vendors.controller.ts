import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { vendorsService } from './vendors.service';
import {
  RegisterVendorSchema,
  UpdateVendorSchema,
  ApproveVendorSchema,
  RejectVendorSchema,
  SuspendVendorSchema,
  GetVendorsQuerySchema,
  UploadDocumentSchema,
  RejectDocumentSchema,
} from './vendors.dto';

export const getPublicVendorBySlug = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await vendorsService.getPublicVendorProfile(req.params.slug!);
  res.json(ok(vendor));
});

export const registerVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = RegisterVendorSchema.parse(req.body);
  const vendor = await vendorsService.registerVendor(req.user!.id, dto);
  res.status(201).json(ok(vendor));
});

export const getVendors = asyncHandler(async (req: Request, res: Response) => {
  const query = GetVendorsQuerySchema.parse(req.query);
  const result = await vendorsService.getVendors(query);
  res.json(ok(result.vendors, { pagination: result.pagination }));
});

export const getVendorById = asyncHandler(async (req: Request, res: Response) => {
  const vendor = await vendorsService.getVendorById(req.params.id!);
  res.json(ok(vendor));
});

export const updateVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateVendorSchema.parse(req.body);
  const vendor = await vendorsService.updateVendor(req.params.id!, dto);
  res.json(ok(vendor));
});

export const approveVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = ApproveVendorSchema.parse(req.body);
  const vendor = await vendorsService.approveVendor(req.params.id!, dto);
  res.json(ok(vendor));
});

export const rejectVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = RejectVendorSchema.parse(req.body);
  const vendor = await vendorsService.rejectVendor(req.params.id!, dto);
  res.json(ok(vendor));
});

export const suspendVendor = asyncHandler(async (req: Request, res: Response) => {
  const dto = SuspendVendorSchema.parse(req.body);
  const vendor = await vendorsService.suspendVendor(req.params.id!, dto);
  res.json(ok(vendor));
});

export const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  const dto = UploadDocumentSchema.parse(req.body);
  const document = await vendorsService.uploadDocument(req.params.id!, dto);
  res.status(201).json(ok(document));
});

export const getVendorDocuments = asyncHandler(async (req: Request, res: Response) => {
  const documents = await vendorsService.getVendorDocuments(req.params.id!);
  res.json(ok(documents));
});

export const verifyDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await vendorsService.verifyDocument(req.params.documentId!);
  res.json(ok(document));
});

export const rejectDocument = asyncHandler(async (req: Request, res: Response) => {
  const dto = RejectDocumentSchema.parse(req.body);
  const result = await vendorsService.rejectDocument(req.params.documentId!, dto);
  res.json(ok(result));
});

export const getDashboardSummary = asyncHandler(async (req: Request, res: Response) => {
  const summary = await vendorsService.getDashboardSummary(req.user!.vendorId!);
  res.json(ok(summary));
});
