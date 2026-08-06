import { Router } from 'express';
import * as ordersController from './orders.controller';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { CreateOrderSchema, GetOrdersQuerySchema, UpdateOrderStatusSchema } from './orders.dto';

const router = Router();

router.post('/', authenticate, validate(CreateOrderSchema), ordersController.createOrder);
router.get('/', authenticate, validate(GetOrdersQuerySchema, 'query'), ordersController.getOrders);
router.get('/:id', authenticate, ordersController.getOrderById);
router.patch('/:id/status', authenticate, authorize(PERMISSIONS.ORDER_MANAGE), validate(UpdateOrderStatusSchema), ordersController.updateOrderStatus);

export default router;
