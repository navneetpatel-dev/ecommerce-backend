import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { shortLinksService } from './shortLinks.service';

export const createShortLink = asyncHandler(async (req: Request, res: Response) => {
  const result = await shortLinksService.createOrGetShortLink(req.body);
  res.status(201).json(ok(result));
});

export const getShortLink = asyncHandler(async (req: Request, res: Response) => {
  const code = req.params.code;
  const result = await shortLinksService.resolveShortLink(code as string);
  res.json(ok(result));
});
