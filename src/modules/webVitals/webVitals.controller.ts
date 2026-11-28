import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { webVitalsService } from './webVitals.service';
import type { WebVitalsSummaryRequest } from './webVitals.dto';

export const record = asyncHandler(async (req: Request, res: Response) => {
  await webVitalsService.record(req.body, req.user?.id ?? null);
  res.status(204).send();
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const rows = await webVitalsService.summary(req.query as unknown as WebVitalsSummaryRequest);
  res.json(ok(rows));
});
