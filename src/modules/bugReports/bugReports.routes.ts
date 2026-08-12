import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  BugCommentSchema,
  BugStatusSchema,
  CreateBugReportSchema,
  DuplicateBugReportSchema,
  TriageBugReportSchema,
  UpdateBugAssignmentSchema,
  WontFixBugReportSchema,
} from './bugReports.dto';
import * as bugReportsController from './bugReports.controller';

const router = Router();

router.post(
  '/',
  authenticate,
  validate(CreateBugReportSchema),
  bugReportsController.create,
);
router.get('/mine', authenticate, bugReportsController.listMine);
router.get(
  '/admin',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  bugReportsController.listAdmin,
);
router.post(
  '/:id/triage',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(TriageBugReportSchema),
  bugReportsController.triage,
);
router.post(
  '/:id/assignment',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(UpdateBugAssignmentSchema),
  bugReportsController.updateAssignment,
);
router.post(
  '/:id/status',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(BugStatusSchema),
  bugReportsController.updateStatus,
);
router.post(
  '/:id/duplicate',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(DuplicateBugReportSchema),
  bugReportsController.markDuplicate,
);
router.post(
  '/:id/wont-fix',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(WontFixBugReportSchema),
  bugReportsController.wontFix,
);
router.post('/:id/verify', authenticate, bugReportsController.verify);
router.post(
  '/:id/comments',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  validate(BugCommentSchema),
  bugReportsController.addComment,
);
router.get(
  '/:id/comments',
  authenticate,
  authorize(PERMISSIONS.BUG_REPORT_MANAGE),
  bugReportsController.listComments,
);
router.get('/:id', authenticate, bugReportsController.getById);

export default router;
