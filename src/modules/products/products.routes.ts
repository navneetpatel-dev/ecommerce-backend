import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import * as productsController from './products.controller';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import {
  checkOwnership,
  checkProductImageOwnership,
  checkProductVariantOwnership,
} from '@middleware/ownership.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { BULK_IMPORT_LIMITS } from '@core/constants/product';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { ValidationError } from '@core/errors/ValidationError';
import {
  CreateProductSchema,
  UpdateProductSchema,
  GetProductsQuerySchema,
  RejectProductSchema,
  AddVariantSchema,
  UpdateVariantSchema,
  AddImageSchema,
  ReplaceImageSchema,
  TrackRecentlyViewedSchema,
} from './products.dto';

const router = Router();

const bulkImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BULK_IMPORT_LIMITS.MAX_FILE_BYTES },
});

/** Translates multer's raw error (e.g. file-too-large) into the app's standard 422 shape. */
function bulkImportUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  bulkImportUpload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const maxMb = BULK_IMPORT_LIMITS.MAX_FILE_BYTES / (1024 * 1024);
      return next(
        new ValidationError(
          err.code === 'LIMIT_FILE_SIZE'
            ? `CSV file exceeds the ${maxMb}MB limit`
            : ERROR_MESSAGES.PRODUCT_BULK_IMPORT_FILE_REQUIRED,
        ),
      );
    }
    return next(err);
  });
}

// Public product browsing (optional auth so vendor/admin dashboards stay unscoped)
router.get('/', optionalAuthenticate, validate(GetProductsQuerySchema, 'query'), productsController.getProducts);
router.get('/slug/:slug', optionalAuthenticate, productsController.getProductBySlug);

// Recently viewed (registered before `/:id` so the literal path wins the match)
router.get('/recently-viewed', authenticate, productsController.getRecentlyViewed);
router.post('/recently-viewed', authenticate, validate(TrackRecentlyViewedSchema), productsController.trackRecentlyViewed);

router.get('/:id', optionalAuthenticate, productsController.getProductById);
// Public, no auth — reads only the precomputed product_affinities table.
router.get('/:id/frequently-bought-together', productsController.getFrequentlyBoughtTogether);

// Vendor product management
router.post('/', authenticate, authorize(PERMISSIONS.PRODUCT_CREATE), validate(CreateProductSchema), productsController.createProduct);
// Vendor-self CSV bulk import
router.post(
  '/bulk-import',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_CREATE),
  bulkImportUploadMiddleware,
  productsController.bulkImportProducts,
);
router.patch('/:id', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE), checkOwnership('product'), validate(UpdateProductSchema), productsController.updateProduct);
router.delete('/:id', authenticate, authorize(PERMISSIONS.PRODUCT_DELETE, PERMISSIONS.PRODUCT_MANAGE), checkOwnership('product'), productsController.deleteProduct);
router.post('/:id/submit', authenticate, authorize(PERMISSIONS.PRODUCT_UPDATE), checkOwnership('product'), productsController.submitForApproval);

// Admin product approval
router.post('/:id/approve', authenticate, authorize(PERMISSIONS.PRODUCT_APPROVE), productsController.approveProduct);
router.post('/:id/reject', authenticate, authorize(PERMISSIONS.PRODUCT_APPROVE), validate(RejectProductSchema), productsController.rejectProduct);
router.post('/:id/archive', authenticate, authorize(PERMISSIONS.PRODUCT_MANAGE), productsController.archiveProduct);

// Variant management
router.post(
  '/:id/variants',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkOwnership('product'),
  validate(AddVariantSchema),
  productsController.addVariant,
);
router.patch(
  '/variants/:variantId',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkProductVariantOwnership(),
  validate(UpdateVariantSchema),
  productsController.updateVariant,
);
router.delete(
  '/variants/:variantId',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkProductVariantOwnership(),
  productsController.deleteVariant,
);

// Image management
router.post(
  '/:id/images',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkOwnership('product'),
  validate(AddImageSchema),
  productsController.addImage,
);
router.patch(
  '/images/:imageId',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkProductImageOwnership(),
  validate(ReplaceImageSchema),
  productsController.replaceImage,
);
router.delete(
  '/images/:imageId',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkProductImageOwnership(),
  productsController.deleteImage,
);
router.patch(
  '/images/:imageId/primary',
  authenticate,
  authorize(PERMISSIONS.PRODUCT_UPDATE, PERMISSIONS.PRODUCT_MANAGE),
  checkProductImageOwnership(),
  productsController.setPrimaryImage,
);

export default router;
