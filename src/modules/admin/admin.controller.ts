import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { adminService } from './admin.service';

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminService.getDashboardMetrics();
  res.json(ok(metrics));
});

export const getPlatformAnalytics = asyncHandler(async (_req: Request, res: Response) => {
  const analytics = await adminService.getPlatformAnalytics();
  res.json(ok(analytics));
});
