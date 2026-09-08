import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { ValidationError } from '@core/errors/ValidationError';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { otpRequestRateLimiter } from '@middleware/rateLimiter.middleware';
import { MAX_BULK_IMPORT_BYTES } from './deliveryAgents.template';
import {
  AssignAgentSchema,
  BulkAssignShipmentsSchema,
  BulkCreateDeliveryAgentsSchema,
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
  ReviewDocumentSchema,
  SubmitDocumentSchema,
} from './deliveryAgents.dto';
import {
  MarkAgentPayoutFailedSchema,
  MarkAgentPayoutPaidSchema,
  UpdateBankDetailsSchema,
} from './deliveryAgentPayouts.dto';
import * as controller from './deliveryAgents.controller';

const router = Router();
const manage = authorize(PERMISSIONS.DELIVERY_AGENT_MANAGE);

const bulkAgentsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BULK_IMPORT_BYTES },
});

function bulkAgentsUploadMiddleware(req: Request, res: Response, next: NextFunction) {
  bulkAgentsUpload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const maxMb = MAX_BULK_IMPORT_BYTES / (1024 * 1024);
      return next(
        new ValidationError(
          err.code === 'LIMIT_FILE_SIZE'
            ? `File exceeds the ${maxMb}MB limit`
            : 'File upload error',
        ),
      );
    }
    return next(err);
  });
}

router.get('/', authenticate, manage, validate(ListDeliveryAgentsSchema, 'query'), controller.list);
router.post('/', authenticate, manage, validate(CreateDeliveryAgentSchema), controller.create);
router.get('/bulk-template', authenticate, manage, controller.downloadBulkTemplate);
router.post('/bulk', authenticate, manage, validate(BulkCreateDeliveryAgentsSchema), controller.bulkCreate);
router.post('/bulk-import-file', authenticate, manage, bulkAgentsUploadMiddleware, controller.bulkImportFile);
router.get('/unassigned-shipments', authenticate, manage, controller.unassignedShipments);
router.get('/unassigned-pickups', authenticate, manage, controller.unassignedPickups);
router.get('/rto-shipments', authenticate, manage, controller.adminRtoQueue);
router.get('/reports/performance', authenticate, manage, controller.performanceReport);
router.get('/reports/stale', authenticate, manage, controller.staleTasks);
router.get('/cash-deposits', authenticate, manage, controller.adminListCashDeposits);
router.patch('/cash-deposits/:depositId', authenticate, manage, validate(VerifyCashDepositSchema), controller.verifyCashDeposit);
router.get('/payouts', authenticate, manage, controller.adminListAgentPayouts);
router.post('/payouts/process', authenticate, manage, controller.processAgentPayouts);
router.patch('/payouts/:payoutId/mark-paid', authenticate, manage, validate(MarkAgentPayoutPaidSchema), controller.markAgentPayoutPaid);
router.patch('/payouts/:payoutId/mark-failed', authenticate, manage, validate(MarkAgentPayoutFailedSchema), controller.markAgentPayoutFailed);
router.patch('/payouts/:payoutId/retry', authenticate, manage, controller.retryAgentPayout);
router.get('/payouts/:payoutId/statement.pdf', authenticate, manage, controller.adminPayoutStatement);
router.get('/documents', authenticate, manage, controller.adminListDocuments);
router.patch('/documents/:documentId/review', authenticate, manage, validate(ReviewDocumentSchema), controller.reviewDocument);
router.post('/shipments/:shipmentId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignShipment);
router.post('/shipments/bulk-assign', authenticate, manage, validate(BulkAssignShipmentsSchema), controller.bulkAssignShipments);
router.post('/shipments/:shipmentId/force-confirm', authenticate, manage, validate(ForceConfirmSchema), controller.forceConfirmDelivery);
router.post('/returns/:returnId/assign', authenticate, manage, validate(AssignAgentSchema), controller.assignPickup);
router.get('/me/profile', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.profile);
router.get('/me/ratings', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myRatings);
router.patch('/me/availability', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(SetAvailabilitySchema), controller.setAvailability);
router.patch('/me/location', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdateLocationSchema), controller.updateLocation);
router.get('/me/shift-summary', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.shiftSummary);
router.post('/me/cash-shift/close', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(CloseCashShiftSchema), controller.closeCashShift);
router.get('/me/cash-deposits', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myCashDeposits);
router.get('/me/payouts', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myPayouts);
router.get('/me/payouts/:payoutId/statement.pdf', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myPayoutStatement);
router.get('/me/earnings', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myEarnings);
router.patch('/me/bank-details', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(UpdateBankDetailsSchema), controller.updateMyBankDetails);
router.post('/me/documents', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), validate(SubmitDocumentSchema), controller.submitDocument);
router.get('/me/documents', authenticate, authorize(PERMISSIONS.SHIPMENT_DELIVERY_UPDATE, PERMISSIONS.RETURN_PICKUP_UPDATE), controller.myDocuments);
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
