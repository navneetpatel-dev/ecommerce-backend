import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import {
  AssignAgentSchema,
  ConfirmDeliverySchema,
  ConfirmPickupSchema,
  CreateDeliveryAgentSchema,
  ForceConfirmSchema,
  ListDeliveryAgentsSchema,
  SetAvailabilitySchema,
  UpdateDeliveryAgentSchema,
  UpdateDeliveryStatusSchema,
  UpdatePickupStatusSchema,
} from './deliveryAgents.dto';
import * as controller from './deliveryAgents.controller';

const router = Router();
const manage = authorize(PERMISSIONS.DELIVERY_AGENT_MANAGE);

router.get('/', authenticate, manage, validate(ListDeliveryAgentsSchema, 'query'), controller.list);
router.post('/', authenticate, manage, validate(CreateDeliveryAgentSchema), controller.create);
router.get('/unassigned-shipments', authenticate, manage, controller.unassignedShipments);
router.post('/shipments/:shipmentId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignShipment);
router.post('/shipments/:shipmentId/force-confirm', authenticate, manage, validate(ForceConfirmSchema), controller.forceConfirmDelivery);
router.post('/returns/:returnId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignPickup);
router.get('/me/profile', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.profile);
router.patch('/me/availability', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(SetAvailabilitySchema), controller.setAvailability);
router.get('/me/deliveries', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), controller.deliveries);
router.patch('/me/deliveries/:shipmentId/status', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), validate(UpdateDeliveryStatusSchema), controller.updateDeliveryStatus);
router.post('/me/deliveries/:shipmentId/request-code', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), otpRequestRateLimiter, controller.requestDeliveryCode);
router.post('/me/deliveries/:shipmentId/confirm', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), validate(ConfirmDeliverySchema), controller.confirmDelivery);
router.get('/me/pickups', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), controller.pickups);
router.post('/me/pickups/:returnId/request-code', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), otpRequestRateLimiter, controller.requestPickupCode);
router.patch('/me/pickups/:returnId/status', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdatePickupStatusSchema), controller.updatePickupStatus);
router.post('/me/pickups/:returnId/confirm', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), validate(ConfirmPickupSchema), controller.confirmPickup);
router.get('/:id/tasks', authenticate, manage, controller.tasks);
router.patch('/:id', authenticate, manage, validate(UpdateDeliveryAgentSchema), controller.update);

export default router;
