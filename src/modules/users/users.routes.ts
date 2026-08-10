import { Router } from 'express';
import * as usersController from './users.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  UpdateUserProfileSchema,
  GetUsersQuerySchema,
  UpdateUserStatusSchema,
  CreateAddressSchema,
  UpdateAddressSchema,
  ListAssigneesQuerySchema,
} from './users.dto';

const router = Router();

// Own profile (aliases: /me and /profile)
router.get('/me', authenticate, usersController.getProfile);
router.patch('/me', authenticate, validate(UpdateUserProfileSchema), usersController.updateProfile);
router.delete('/me', authenticate, usersController.deleteOwnAccount);
router.get('/me/export', authenticate, usersController.exportAccount);

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

// Assignee picker for ticket / bug queues — before `/:id`
router.get(
  '/assignees',
  authenticate,
  authorize(PERMISSIONS.TICKET_MANAGE, PERMISSIONS.BUG_REPORT_MANAGE),
  validate(ListAssigneesQuerySchema, 'query'),
  usersController.listAssignees,
);

// Admin user management
router.get('/', authenticate, authorize(PERMISSIONS.USER_MANAGE), validate(GetUsersQuerySchema, 'query'), usersController.getUsers);
router.get('/:id', authenticate, authorize(PERMISSIONS.USER_MANAGE), usersController.getUserById);
router.patch('/:id/status', authenticate, authorize(PERMISSIONS.USER_MANAGE), validate(UpdateUserStatusSchema), usersController.updateUserStatus);
router.delete('/:id', authenticate, authorize(PERMISSIONS.USER_MANAGE), usersController.deleteUser);

export default router;
