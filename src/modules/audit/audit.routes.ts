import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import * as auditController from './audit.controller';

const router = Router();

router.get('/', authenticate, authorize(PERMISSIONS.AUDIT_VIEW), auditController.listAuditLogs);

export default router;
