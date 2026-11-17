import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { contactService } from './contact.service';

export const submit = asyncHandler(async (req: Request, res: Response) => {
  // A filled honeypot is a bot: answer as if it worked, send nothing.
  if (req.body.website) {
    res.status(201).json(ok({ reference: 'CM-000000' }));
    return;
  }
  const result = await contactService.submit(req.body, req.user?.id);
  res.status(201).json(ok(result));
});
