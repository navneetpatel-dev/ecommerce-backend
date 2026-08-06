import { Router } from 'express';
import * as productsController from './products.controller';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { checkOwnership } from '@middleware/ownership.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  CreateProductSchema,
  UpdateProductSchema,
  GetProductsQuerySchema,
  RejectProductSchema,
  AddVariantSchema,
  UpdateVariantSchema,
  AddImageSchema,
} from './products.dto';

const router = Router();

// Public product browsing (optional auth so vendor/admin dashboards stay unscoped)
router.get('/', optionalAuthenticate, validate(GetProductsQuerySchema, 'query'), productsController.getProducts);
router.get('/slug/:slug', optionalAuthenticate, productsController.getProductBySlug);
router.get('/:id', optionalAuthenticate, productsController.getProductById);

// Vendor product management
router.post('/', authenticate, authorize(PERMISSIONS.PRODUCT_CREATE), validate(CreateProductSchema), productsController.createProduct);
router.patch('/:id', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), checkOwnership('product'), validate(UpdateProductSchema), productsController.updateProduct);
router.delete('/:id', authenticate, authorize(PERMISSIONS.PRODUCT_DELETE, PERMISSIONS.PRODUCT_MANAGE), checkOwnership('product'), productsController.deleteProduct);
router.post('/:id/submit', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE), checkOwnership('product'), productsController.submitForApproval);

// Admin product approval
router.post('/:id/approve', authenticate, authorize(PERMISSIONS.PRODUCT_APPROVE), productsController.approveProduct);
router.post('/:id/reject', authenticate, authorize(PERMISSIONS.PRODUCT_APPROVE), validate(RejectProductSchema), productsController.rejectProduct);
router.post('/:id/archive', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE), productsController.archiveProduct);

// Variant management
router.post('/:id/variants', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), validate(AddVariantSchema), productsController.addVariant);
router.patch('/variants/:variantId', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), validate(UpdateVariantSchema), productsController.updateVariant);
router.delete('/variants/:variantId', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), productsController.deleteVariant);

// Image management
router.post('/:id/images', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), validate(AddImageSchema), productsController.addImage);
router.delete('/images/:imageId', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), productsController.deleteImage);
router.patch('/images/:imageId/primary', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), productsController.setPrimaryImage);

export default router;
