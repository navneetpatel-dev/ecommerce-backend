import { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { adminService } from './admin.service';
import { buildPlatformAnalyticsExport } from './adminAnalyticsExport';

export const getDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await adminService.getDashboardMetrics();
  res.json(ok(metrics));
});

export const getPlatformAnalytics = asyncHandler(async (_req: Request, res: Response) => {
  const analytics = await adminService.getPlatformAnalytics();
  res.json(ok(analytics));
});

const AnalyticsExportSchema = z.object({
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
});

export const exportPlatformAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { format } = AnalyticsExportSchema.parse(req.query);
  const analytics = await adminService.getPlatformAnalytics();
  const buffer = await buildPlatformAnalyticsExport(analytics, format);
  const ext = format;
  const contentType =
    format === 'csv'
      ? 'text/csv; charset=utf-8'
      : format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="platform-analytics_${new Date().toISOString().slice(0, 10)}.${ext}"`,
  );
  res.send(buffer);
});
