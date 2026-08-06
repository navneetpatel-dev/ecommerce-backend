import { Router } from 'express';
import * as usersController from './users.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import {
  UpdateUserProfileSchema,
  GetUsersQuerySchema,
  UpdateUserStatusSchema,
  CreateAddressSchema,
} from './users.dto';

const router = Router();

// User's own profile
router.get('/profile', authenticate, usersController.getProfile);
router.patch('/profile', authenticate, validate(UpdateUserProfileSchema), usersController.updateProfile);

// Addresses — must be registered before `/:id`
router.get('/addresses', authenticate, usersController.listAddresses);
router.post(
  '/addresses',
  authenticate,
  validate(CreateAddressSchema),
  usersController.createAddress,
);

// Admin user management
router.get('/', authenticate, authorize('users.view'), validate(GetUsersQuerySchema, 'query'), usersController.getUsers);
router.get('/:id', authenticate, authorize('users.view'), usersController.getUserById);
router.patch('/:id/status', authenticate, authorize('users.update'), validate(UpdateUserStatusSchema), usersController.updateUserStatus);
router.delete('/:id', authenticate, authorize('users.delete'), usersController.deleteUser);

export default router;
