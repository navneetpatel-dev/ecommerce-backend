import { Router } from 'express';
import * as productsController from './products.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { checkOwnership } from '@middleware/ownership.middleware';
import { validate } from '@middleware/validate.middleware';
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

// Public product browsing
router.get('/', validate(GetProductsQuerySchema, 'query'), productsController.getProducts);
router.get('/:id', productsController.getProductById);
router.get('/slug/:slug', productsController.getProductBySlug);

// Vendor product management
router.post('/', authenticate, authorize('products.create'), validate(CreateProductSchema), productsController.createProduct);
router.patch('/:id', authenticate, authorize('products.update'), checkOwnership('product'), validate(UpdateProductSchema), productsController.updateProduct);
router.delete('/:id', authenticate, authorize('products.delete'), checkOwnership('product'), productsController.deleteProduct);
router.post('/:id/submit', authenticate, authorize('products.submit'), checkOwnership('product'), productsController.submitForApproval);

// Admin product approval
router.post('/:id/approve', authenticate, authorize('products.approve'), productsController.approveProduct);
router.post('/:id/reject', authenticate, authorize('products.approve'), validate(RejectProductSchema), productsController.rejectProduct);
router.post('/:id/archive', authenticate, authorize('products.archive'), productsController.archiveProduct);

// Variant management
router.post('/:id/variants', authenticate, authorize('products.update'), validate(AddVariantSchema), productsController.addVariant);
router.patch('/variants/:variantId', authenticate, authorize('products.update'), validate(UpdateVariantSchema), productsController.updateVariant);
router.delete('/variants/:variantId', authenticate, authorize('products.update'), productsController.deleteVariant);

// Image management
router.post('/:id/images', authenticate, authorize('products.update'), validate(AddImageSchema), productsController.addImage);
router.delete('/images/:imageId', authenticate, authorize('products.update'), productsController.deleteImage);
router.patch('/images/:imageId/primary', authenticate, authorize('products.update'), productsController.setPrimaryImage);

export default router;
