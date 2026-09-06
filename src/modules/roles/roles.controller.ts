import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { rolesService } from './roles.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const roles = await rolesService.list();
  res.json(ok(roles));
});

export const listAvailablePermissions = asyncHandler(async (req: Request, res: Response) => {
  const permissions = await rolesService.listAvailablePermissions();
  res.json(ok(permissions));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const role = await rolesService.create(req.body);
  res.status(201).json(ok(role));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const role = await rolesService.update(req.params.id!, req.body);
  res.json(ok(role));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await rolesService.delete(req.params.id!);
  res.json(ok({ deleted: true }));
});

export const setPermissions = asyncHandler(async (req: Request, res: Response) => {
  const role = await rolesService.setPermissions(req.params.id!, req.body);
  res.json(ok(role));
});
