import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateRoleSchema, UpdateRoleSchema, SetRolePermissionsSchema } from './roles.dto';
import * as rolesController from './roles.controller';

const router = Router();

router.use(authenticate, authorize(PERMISSIONS.ROLE_MANAGE));

router.get('/', rolesController.list);
router.get('/permissions', rolesController.listAvailablePermissions);
router.post('/', validate(CreateRoleSchema), rolesController.create);
router.patch('/:id', validate(UpdateRoleSchema), rolesController.update);
router.delete('/:id', rolesController.remove);
router.patch('/:id/permissions', validate(SetRolePermissionsSchema), rolesController.setPermissions);

export default router;
