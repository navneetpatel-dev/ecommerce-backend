import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { CreateExportJobSchema } from './exports.dto';
import * as exportsService from './exports.service';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import type { ExportActor } from '@core/export/exportSourceRegistry';
import type { PermissionKey } from '@core/permissions/permissionKeys';

async function actorFromReq(req: Request): Promise<ExportActor> {
  const user = req.user!;
  const roleName = user.role?.name ?? roleNameOf(user as any);
  const permissions = (await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  })) as PermissionKey[];
  return { id: user.id, vendorId: user.vendorId ?? null, roleName, permissions };
}

export const createExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const input = CreateExportJobSchema.parse(req.body);
  const result = await exportsService.startExport(actor, input);
  res.status(202).json(ok(result));
});

export const getExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const result = await exportsService.getExportStatus(actor, req.params.jobId!);
  res.json(ok(result));
});

export const downloadExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const url = await exportsService.getExportDownloadUrl(actor, req.params.jobId!);
  res.json(ok({ url }));
});

export const listExports = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const jobs = await exportsService.listMyExports(actor);
  res.json(ok(jobs));
});

export const cancelExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  await exportsService.cancelExport(actor, req.params.jobId!);
  res.json(ok({ cancelled: true }));
});

export const acknowledgeExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  await exportsService.acknowledgeExport(actor, req.params.jobId!);
  res.json(ok({ acknowledged: true }));
});
