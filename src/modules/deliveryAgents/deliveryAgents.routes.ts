import { Router } from 'express';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import {
  AssignAgentSchema,
  BulkAssignShipmentsSchema,
  CloseCashShiftSchema,
  ConfirmDeliverySchema,
  ConfirmPickupSchema,
  ConfirmRtoHandoverSchema,
  CreateDeliveryAgentSchema,
  ForceConfirmSchema,
  ListDeliveryAgentsSchema,
  SetAvailabilitySchema,
  UpdateDeliveryAgentSchema,
  UpdateDeliveryStatusSchema,
  UpdateLocationSchema,
  UpdatePickupStatusSchema,
  VerifyCashDepositSchema,
} from './deliveryAgents.dto';
import {
  MarkAgentPayoutFailedSchema,
  MarkAgentPayoutPaidSchema,
  UpdateBankDetailsSchema,
} from './deliveryAgentPayouts.dto';
import * as controller from './deliveryAgents.controller';

const router = Router();
const manage = authorize(PERMISSIONS.DELIVERY_AGENT_MANAGE);

router.get('/', authenticate, manage, validate(ListDeliveryAgentsSchema, 'query'), controller.list);
router.post('/', authenticate, manage, validate(CreateDeliveryAgentSchema), controller.create);
router.get('/unassigned-shipments', authenticate, manage, controller.unassignedShipments);
router.get('/unassigned-pickups', authenticate, manage, controller.unassignedPickups);
router.get('/rto-shipments', authenticate, manage, controller.adminRtoQueue);
router.get('/cash-deposits', authenticate, manage, controller.adminListCashDeposits);
router.patch('/cash-deposits/:depositId', authenticate, manage, validate(VerifyCashDepositSchema), controller.verifyCashDeposit);
router.get('/payouts', authenticate, manage, controller.adminListAgentPayouts);
router.post('/payouts/process', authenticate, manage, controller.processAgentPayouts);
router.patch('/payouts/:payoutId/mark-paid', authenticate, manage, validate(MarkAgentPayoutPaidSchema), controller.markAgentPayoutPaid);
router.patch('/payouts/:payoutId/mark-failed', authenticate, manage, validate(MarkAgentPayoutFailedSchema), controller.markAgentPayoutFailed);
router.patch('/payouts/:payoutId/retry', authenticate, manage, controller.retryAgentPayout);
router.post('/shipments/:shipmentId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignShipment);
router.post('/shipments/bulk-assign', authenticate, manage, validate(BulkAssignShipmentsSchema), controller.bulkAssignShipments);
router.post('/shipments/:shipmentId/force-confirm', authenticate, manage, validate(ForceConfirmSchema), controller.forceConfirmDelivery);
router.post('/returns/:returnId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignPickup);
router.get('/me/profile', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.profile);
router.patch('/me/availability', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(SetAvailabilitySchema), controller.setAvailability);
router.patch('/me/location', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdateLocationSchema), controller.updateLocation);
router.get('/me/shift-summary', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.shiftSummary);
router.post('/me/cash-shift/close', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(CloseCashShiftSchema), controller.closeCashShift);
router.get('/me/cash-deposits', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myCashDeposits);
router.get('/me/payouts', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myPayouts);
router.get('/me/earnings', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myEarnings);
router.patch('/me/bank-details', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdateBankDetailsSchema), controller.updateMyBankDetails);
router.get('/me/deliveries', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), controller.deliveries);
router.get('/me/deliveries/:shipmentId', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), controller.delivery);
router.patch('/me/deliveries/:shipmentId/status', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), validate(UpdateDeliveryStatusSchema), controller.updateDeliveryStatus);
router.post('/me/deliveries/:shipmentId/request-code', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), otpRequestRateLimiter, controller.requestDeliveryCode);
router.post('/me/deliveries/:shipmentId/confirm', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), validate(ConfirmDeliverySchema), controller.confirmDelivery);
router.post('/me/deliveries/:shipmentId/rto-handover/request-code', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), otpRequestRateLimiter, controller.requestRtoHandoverCode);
router.post('/me/deliveries/:shipmentId/rto-handover/confirm', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE), validate(ConfirmRtoHandoverSchema), controller.confirmRtoHandover);
router.get('/me/pickups', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), controller.pickups);
router.get('/me/pickups/:returnId', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), controller.pickup);
router.post('/me/pickups/:returnId/request-code', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), otpRequestRateLimiter, controller.requestPickupCode);
router.patch('/me/pickups/:returnId/status', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdatePickupStatusSchema), controller.updatePickupStatus);
router.post('/me/pickups/:returnId/confirm', authenticate, authorize(PERMISSIONS.RETURN_PICKUP_UPDATE), validate(ConfirmPickupSchema), controller.confirmPickup);
router.get('/:id/tasks', authenticate, manage, controller.tasks);
router.patch('/:id', authenticate, manage, validate(UpdateDeliveryAgentSchema), controller.update);

export default router;
