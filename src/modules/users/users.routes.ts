import { Router } from 'express';
import * as usersController from './users.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { UpdateUserProfileSchema, GetUsersQuerySchema, UpdateUserStatusSchema } from './users.dto';

const router = Router();

// User's own profile
router.get('/profile', authenticate, usersController.getProfile);
router.patch('/profile', authenticate, validate(UpdateUserProfileSchema), usersController.updateProfile);

// Admin user management
router.get('/', authenticate, authorize('users.view'), validate(GetUsersQuerySchema, 'query'), usersController.getUsers);
router.get('/:id', authenticate, authorize('users.view'), usersController.getUserById);
router.patch('/:id/status', authenticate, authorize('users.update'), validate(UpdateUserStatusSchema), usersController.updateUserStatus);
router.delete('/:id', authenticate, authorize('users.delete'), usersController.deleteUser);

export default router;
