import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { newsletterService } from './newsletter.service';

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  const result = await newsletterService.subscribe(req.body);
  res.status(result.alreadySubscribed ? 200 : 201).json(ok(result));
});
