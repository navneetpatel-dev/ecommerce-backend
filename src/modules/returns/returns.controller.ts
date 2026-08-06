import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { returnsService } from './returns.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const created = await returnsService.create(req.user!.id, req.body);
  res.status(201).json(ok(created));
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const items = await returnsService.listForUser(req.user!.id);
  res.json(ok(items));
});

export const listAdmin = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await returnsService.listAll(query);
  res.json(ok(result.returns, { pagination: result.pagination }));
});

export const transition = asyncHandler(async (req: Request, res: Response) => {
  const updated = await returnsService.transition(req.params.id!, req.body.status, req.user!.id);
  res.json(ok(updated));
});
