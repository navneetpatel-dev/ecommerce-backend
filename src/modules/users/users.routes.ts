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
  UpdateAddressSchema,
  ConfirmEmailSchema,
  UploadAvatarSchema,
} from './users.dto';

const router = Router();

// Own profile (aliases: /me and /profile)
router.get('/me', authenticate, usersController.getProfile);
router.patch('/me', authenticate, validate(UpdateUserProfileSchema), usersController.updateProfile);
router.delete('/me', authenticate, usersController.deleteOwnAccount);
router.get('/me/export', authenticate, usersController.exportAccount);
router.post('/me/avatar', authenticate, validate(UploadAvatarSchema), usersController.uploadAvatar);
router.post(
  '/me/confirm-email',
  authenticate,
  validate(ConfirmEmailSchema),
  usersController.confirmEmail,
);

router.get('/profile', authenticate, usersController.getProfile);
router.patch('/profile', authenticate, validate(UpdateUserProfileSchema), usersController.updateProfile);

// Addresses — before `/:id`
router.get('/addresses', authenticate, usersController.listAddresses);
router.post(
  '/addresses',
  authenticate,
  validate(CreateAddressSchema),
  usersController.createAddress,
);
router.patch(
  '/addresses/:addressId',
  authenticate,
  validate(UpdateAddressSchema),
  usersController.updateAddress,
);
router.delete('/addresses/:addressId', authenticate, usersController.deleteAddress);
router.post('/addresses/:addressId/default', authenticate, usersController.setDefaultAddress);

// Admin user management
router.get('/', authenticate, authorize('users.view'), validate(GetUsersQuerySchema, 'query'), usersController.getUsers);
router.get('/:id', authenticate, authorize('users.view'), usersController.getUserById);
router.patch('/:id/status', authenticate, authorize('users.update'), validate(UpdateUserStatusSchema), usersController.updateUserStatus);
router.delete('/:id', authenticate, authorize('users.delete'), usersController.deleteUser);

export default router;
