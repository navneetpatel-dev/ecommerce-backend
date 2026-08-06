import { Router } from 'express';
import * as categoriesController from './categories.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateCategorySchema, UpdateCategorySchema } from './categories.dto';

const router = Router();

// public category browsing
router.get('/', categoriesController.getCategories);
router.get('/:id', categoriesController.getCategoryById);

// admin category management
router.post('/', authenticate, authorize(PERMISSIONS.CATEGORY_MANAGE), validate(CreateCategorySchema), categoriesController.createCategory);
router.patch('/:id', authenticate, authorize(PERMISSIONS.CATEGORY_MANAGE), validate(UpdateCategorySchema), categoriesController.updateCategory);
router.delete('/:id', authenticate, authorize(PERMISSIONS.CATEGORY_MANAGE), categoriesController.deleteCategory);

export default router;
