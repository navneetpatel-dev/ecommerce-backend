import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ListAuditQuerySchema } from './audit.dto';
import * as auditController from './audit.controller';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize(PERMISSIONS.AUDIT_VIEW),
  validate(ListAuditQuerySchema, 'query'),
  auditController.listAuditLogs,
);

export default router;
