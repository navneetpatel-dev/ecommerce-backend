import { Router } from 'express';
import * as categoriesController from './categories.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  CreateCategoryAttributeSchema,
  CreateCategorySchema,
  ReassignProductsSchema,
  ReorderAttributesSchema,
  ReorderCategoriesSchema,
  UpdateCategoryAttributeSchema,
  UpdateCategorySchema,
} from './categories.dto';

const router = Router();

// public category browsing (static paths before /:id)
router.get('/', categoriesController.getCategories);
router.get('/resolve', categoriesController.resolveCategoryPath);
router.get('/:idOrSlug/facets', categoriesController.getCategoryFacets);

// admin category management (static admin paths before /:id)
router.patch(
  '/reorder',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(ReorderCategoriesSchema),
  categoriesController.reorderCategories,
);
router.post(
  '/reassign-products',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(ReassignProductsSchema),
  categoriesController.reassignProducts,
);

router.get(
  '/:categoryId/attributes',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  categoriesController.listAttributes,
);
router.post(
  '/:categoryId/attributes',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(CreateCategoryAttributeSchema),
  categoriesController.createAttribute,
);
router.patch(
  '/:categoryId/attributes/reorder',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(ReorderAttributesSchema),
  categoriesController.reorderAttributes,
);
router.patch(
  '/:categoryId/attributes/:attributeId',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(UpdateCategoryAttributeSchema),
  categoriesController.updateAttribute,
);
router.delete(
  '/:categoryId/attributes/:attributeId',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  categoriesController.deleteAttribute,
);

router.get(
  '/:id/product-count',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  categoriesController.getCategoryProductCount,
);
router.get('/:id', categoriesController.getCategoryById);

router.post(
  '/',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(CreateCategorySchema),
  categoriesController.createCategory,
);
router.patch(
  '/:id',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  validate(UpdateCategorySchema),
  categoriesController.updateCategory,
);
router.delete(
  '/:id',
  authenticate,
  authorize(PERMISSIONS.CATEGORY_MANAGE),
  categoriesController.deleteCategory,
);

export default router;
