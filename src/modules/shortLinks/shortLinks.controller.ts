import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { shortLinksService } from './shortLinks.service';
import type { CreateShortLinkInput } from './shortLinks.dto';

export const createShortLink = asyncHandler(async (req: Request, res: Response) => {
  const { targetUrl, resourceType, resourceId } = req.body as CreateShortLinkInput;
  const result = await shortLinksService.createOrGetShortLink({ targetUrl: targetUrl ?? '', resourceType, resourceId });
  res.status(201).json(ok(result));
});

export const getShortLink = asyncHandler(async (req: Request, res: Response) => {
  const code = req.params.code;
  const result = await shortLinksService.resolveShortLink(code as string);
  res.json(ok(result));
});
