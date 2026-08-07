import { Router } from 'express';
import * as vendorsController from './vendors.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  RegisterVendorSchema,
  UpdateVendorSchema,
  ApproveVendorSchema,
  RejectVendorSchema,
  SuspendVendorSchema,
  GetVendorsQuerySchema,
  UploadDocumentSchema,
  RejectDocumentSchema,
} from './vendors.dto';

const router = Router();

// Public storefront — APPROVED vendors only (404 otherwise)
router.get('/slug/:slug', vendorsController.getPublicVendorBySlug);

// Public vendor registration
router.post('/register', authenticate, validate(RegisterVendorSchema), vendorsController.registerVendor);

// Vendor dashboard
router.get('/dashboard/summary', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_CREATE, PERMISSIONS.SUBORDER_MANAGE, PERMISSIONS.PAYOUT_VIEW), vendorsController.getDashboardSummary);

// Admin vendor management
router.get('/', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.VENDOR_APPROVE), validate(GetVendorsQuerySchema, 'query'), vendorsController.getVendors);
router.get('/:id', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.VENDOR_APPROVE), vendorsController.getVendorById);
router.patch('/:id', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), validate(UpdateVendorSchema), vendorsController.updateVendor);
router.patch('/:id/approve', authenticate, authorize(PERMISSIONS.VENDOR_APPROVE), validate(ApproveVendorSchema), vendorsController.approveVendor);
router.patch('/:id/reject', authenticate, authorize(PERMISSIONS.VENDOR_APPROVE), validate(RejectVendorSchema), vendorsController.rejectVendor);
router.patch('/:id/suspend', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), validate(SuspendVendorSchema), vendorsController.suspendVendor);

// Vendor documents
router.post('/:id/documents', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), validate(UploadDocumentSchema), vendorsController.uploadDocument);
router.get('/:id/documents', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), vendorsController.getVendorDocuments);
router.patch('/documents/:documentId/verify', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), vendorsController.verifyDocument);
router.patch(
  '/documents/:documentId/reject',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  validate(RejectDocumentSchema),
  vendorsController.rejectDocument,
);

export default router;
