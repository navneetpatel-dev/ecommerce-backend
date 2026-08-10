import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { VENDOR_ROLES } from '@core/constants/statuses';
import {
  CreateSupportTicketSchema,
  RateSupportTicketSchema,
  ReassignSupportTicketSchema,
  ReplySupportTicketSchema,
} from './supportTickets.dto';
import * as supportTicketsController from './supportTickets.controller';

const router = Router();

function requireVendorRole(req: Request, _res: Response, next: NextFunction) {
  const role = req.user?.role?.name;
  if (!role || !(VENDOR_ROLES as readonly string[]).includes(role) || !req.user?.vendorId) {
    return next(new ForbiddenError(ERROR_MESSAGES.VENDOR_NOT_LINKED));
  }
  return next();
}

router.post(
  '/',
  authenticate,
  validate(CreateSupportTicketSchema),
  supportTicketsController.create,
);
router.get('/mine', authenticate, supportTicketsController.listMine);
router.get(
  '/vendor',
  authenticate,
  requireVendorRole,
  supportTicketsController.listVendor,
);
router.get(
  '/admin',
  authenticate,
  authorize(PERMISSIONS.TICKET_MANAGE),
  supportTicketsController.listAdmin,
);
router.get('/:id/messages', authenticate, supportTicketsController.listMessages);
router.post(
  '/:id/messages',
  authenticate,
  validate(ReplySupportTicketSchema),
  supportTicketsController.reply,
);
router.post('/:id/resolve', authenticate, supportTicketsController.resolve);
router.post('/:id/reopen', authenticate, supportTicketsController.reopen);
router.post(
  '/:id/close',
  authenticate,
  authorize(PERMISSIONS.TICKET_MANAGE),
  supportTicketsController.close,
);
router.post(
  '/:id/reassign',
  authenticate,
  authorize(PERMISSIONS.TICKET_MANAGE),
  validate(ReassignSupportTicketSchema),
  supportTicketsController.reassign,
);
router.post(
  '/:id/rate',
  authenticate,
  validate(RateSupportTicketSchema),
  supportTicketsController.rate,
);
router.get('/:id', authenticate, supportTicketsController.getById);

export default router;
