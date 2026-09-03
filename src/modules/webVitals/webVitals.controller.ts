import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { webVitalsService } from './webVitals.service';

export const record = asyncHandler(async (req: Request, res: Response) => {
  await webVitalsService.record(req.body, req.user?.id ?? null);
  res.status(204).send();
});
