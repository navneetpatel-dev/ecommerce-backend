import { Router } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { validate } from '@middleware/validate.middleware';
import { CreateHelpTicketSchema } from './help.dto';
import { helpService } from './help.service';

const router = Router();

router.post(
  '/tickets',
  optionalAuthenticate,
  validate(CreateHelpTicketSchema),
  asyncHandler(async (req, res) => {
    const ticket = await helpService.createTicket(req.body, req.user?.id ?? null);
    res.status(201).json(ok(ticket));
  }),
);

router.get(
  '/tickets/mine',
  authenticate,
  asyncHandler(async (req, res) => {
    const tickets = await helpService.listTicketsForUser(req.user!.id);
    res.json(ok(tickets));
  }),
);

export default router;
