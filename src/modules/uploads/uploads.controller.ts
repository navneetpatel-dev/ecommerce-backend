import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import type {
  PresignBulkRequest,
  PresignSingleRequest,
  UploadBulkRequest,
  UploadSingleRequest,
} from './uploads.dto';
import { uploadsService } from './uploads.service';

function uploadActor(req: Request) {
  const user = req.user!;
  return {
    id: user.id,
    vendorId: user.vendorId,
    deliveryAgentId: user.deliveryAgentId,
    role: user.role,
    roleId: user.roleId,
  };
}

export const presignSingle = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as PresignSingleRequest;
  const result = await uploadsService.presignSingle(uploadActor(req), dto);
  res.status(201).json(ok(result));
});

export const presignBulk = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as PresignBulkRequest;
  const result = await uploadsService.presignBulk(uploadActor(req), dto);
  res.status(201).json(ok(result));
});

export const uploadSingle = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as UploadSingleRequest;
  const result = await uploadsService.uploadSingle(uploadActor(req), dto);
  res.status(201).json(ok(result));
});

export const uploadBulk = asyncHandler(async (req: Request, res: Response) => {
  const dto = req.body as UploadBulkRequest;
  const result = await uploadsService.uploadBulk(uploadActor(req), dto);
  res.status(201).json(ok(result));
});
