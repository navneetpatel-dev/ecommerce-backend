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
  ResolveDocumentsQuerySchema,
} from './vendors.dto';

const router = Router();

const vendorDashAuth = authorize(
  PERMISSIONS.PRODUCT_UPDATE,
  PERMISSIONS.PRODUCT_CREATE,
  PERMISSIONS.SUBORDER_MANAGE,
  PERMISSIONS.PAYOUT_VIEW,
);

// Public storefront — APPROVED vendors only (404 otherwise)
router.get('/slug/:slug', vendorsController.getPublicVendorBySlug);

// Preview required docs before / during onboarding
router.get(
  '/document-requirements',
  validate(ResolveDocumentsQuerySchema, 'query'),
  vendorsController.previewRequiredDocuments,
);

// Public vendor registration
router.post('/register', authenticate, validate(RegisterVendorSchema), vendorsController.registerVendor);

// Vendor dashboard
router.get('/dashboard/summary', authenticate, vendorDashAuth, vendorsController.getDashboardSummary);
router.get('/me', authenticate, vendorDashAuth, vendorsController.getMyVendor);
router.patch(
  '/me',
  authenticate,
  vendorDashAuth,
  validate(UpdateVendorSchema),
  vendorsController.updateMyVendor,
);
router.get('/me/documents', authenticate, vendorDashAuth, vendorsController.getMyDocuments);
router.post(
  '/me/documents',
  authenticate,
  vendorDashAuth,
  validate(UploadDocumentSchema),
  vendorsController.uploadMyDocument,
);
router.get('/me/kyc-checklist', authenticate, vendorDashAuth, vendorsController.getMyKycChecklist);

// Admin vendor management (static admin document routes before /:id)
router.get(
  '/',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.VENDOR_APPROVE),
  validate(GetVendorsQuerySchema, 'query'),
  vendorsController.getVendors,
);
router.patch(
  '/documents/:documentId/verify',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  vendorsController.verifyDocument,
);
router.patch(
  '/documents/:documentId/reject',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  validate(RejectDocumentSchema),
  vendorsController.rejectDocument,
);
router.get(
  '/documents/:documentId/view-url',
  authenticate,
  authorize(
    PERMISSIONS.VENDOR_MANAGE,
    PERMISSIONS.VENDOR_APPROVE,
    PERMISSIONS.PRODUCT_UPDATE,
    PERMISSIONS.PRODUCT_CREATE,
  ),
  vendorsController.getDocumentViewUrl,
);

router.get(
  '/:id',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.VENDOR_APPROVE),
  vendorsController.getVendorById,
);
router.patch(
  '/:id',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  validate(UpdateVendorSchema),
  vendorsController.updateVendor,
);
router.delete('/:id', authenticate, authorize(PERMISSIONS.VENDOR_MANAGE), vendorsController.deleteVendor);
router.patch(
  '/:id/approve',
  authenticate,
  authorize(PERMISSIONS.VENDOR_APPROVE),
  validate(ApproveVendorSchema),
  vendorsController.approveVendor,
);
router.patch(
  '/:id/reject',
  authenticate,
  authorize(PERMISSIONS.VENDOR_APPROVE),
  validate(RejectVendorSchema),
  vendorsController.rejectVendor,
);
router.patch(
  '/:id/suspend',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  validate(SuspendVendorSchema),
  vendorsController.suspendVendor,
);

router.post(
  '/:id/documents',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  validate(UploadDocumentSchema),
  vendorsController.uploadDocument,
);
router.get(
  '/:id/documents',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE),
  vendorsController.getVendorDocuments,
);
router.get(
  '/:id/kyc-checklist',
  authenticate,
  authorize(PERMISSIONS.VENDOR_MANAGE, PERMISSIONS.VENDOR_APPROVE),
  vendorsController.getVendorKycChecklist,
);

export default router;
