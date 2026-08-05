import { Router } from 'express';
import * as vendorsController from './vendors.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import {
  RegisterVendorSchema,
  UpdateVendorSchema,
  ApproveVendorSchema,
  RejectVendorSchema,
  SuspendVendorSchema,
  GetVendorsQuerySchema,
  UploadDocumentSchema,
} from './vendors.dto';

const router = Router();

// Public vendor registration
router.post('/register', authenticate, validate(RegisterVendorSchema), vendorsController.registerVendor);

// Vendor dashboard
router.get('/dashboard/summary', authenticate, authorize('vendor.dashboard'), vendorsController.getDashboardSummary);

// Admin vendor management
router.get('/', authenticate, authorize('vendors.view'), validate(GetVendorsQuerySchema, 'query'), vendorsController.getVendors);
router.get('/:id', authenticate, authorize('vendors.view'), vendorsController.getVendorById);
router.patch('/:id', authenticate, authorize('vendors.update'), validate(UpdateVendorSchema), vendorsController.updateVendor);
router.patch('/:id/approve', authenticate, authorize('vendors.approve'), validate(ApproveVendorSchema), vendorsController.approveVendor);
router.patch('/:id/reject', authenticate, authorize('vendors.approve'), validate(RejectVendorSchema), vendorsController.rejectVendor);
router.patch('/:id/suspend', authenticate, authorize('vendors.suspend'), validate(SuspendVendorSchema), vendorsController.suspendVendor);

// Vendor documents
router.post('/:id/documents', authenticate, authorize('vendors.documents'), validate(UploadDocumentSchema), vendorsController.uploadDocument);
router.get('/:id/documents', authenticate, authorize('vendors.documents'), vendorsController.getVendorDocuments);
router.patch('/documents/:documentId/verify', authenticate, authorize('vendors.verify_documents'), vendorsController.verifyDocument);

export default router;
