import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { sendDownload } from '@core/http/sendDownload';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import { reportEngine, type ReportActor } from '@modules/reports/engine/reportEngine';
import { assertReportRange, inclusiveReportTo } from '@modules/reports/engine/queryHelpers';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { adminService } from './admin.service';

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminService.getDashboardMetrics();
  res.json(ok(metrics));
});

export const getPlatformAnalytics = asyncHandler(async (_req: Request, res: Response) => {
  const analytics = await adminService.getPlatformAnalytics();
  res.json(ok(analytics));
});

const AnalyticsExportSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional().transform((value) => (value ? inclusiveReportTo(value) : undefined)),
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

async function analyticsActor(req: Request): Promise<ReportActor> {
  const user = req.user!;
  const roleName = user.role?.name ?? roleNameOf(user as any);
  const permissions = (await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  })) as PermissionKey[];
  return {
    id: user.id,
    vendorId: user.vendorId ?? null,
    roleName,
    permissions,
  };
}

export const exportPlatformAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { format, from: fromParam, to: toParam } = AnalyticsExportSchema.parse(req.query);
  const to = toParam ?? new Date();
  const from = fromParam ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  assertReportRange({ from, to });
  const actor = await analyticsActor(req);
  const result = await reportEngine.runExportDirect(actor, 'platform-analytics', { from, to }, format);
  sendDownload(res, result);
});
