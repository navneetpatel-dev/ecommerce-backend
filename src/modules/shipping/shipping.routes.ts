import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  GetShippingRatesSchema,
  GetServiceabilitySchema,
  CreateZoneSchema,
  UpdateZoneSchema,
  CreateRateSchema,
  UpdateRateSchema,
  RescheduleDeliverySchema,
  AdminShipmentStatusSchema,
} from './shipping.dto';
import * as shippingController from './shipping.controller';

const router = Router();

router.get('/rates', optionalAuthenticate, validate(GetShippingRatesSchema, 'query'), shippingController.getRates);

router.get('/serviceability', optionalAuthenticate, validate(GetServiceabilitySchema, 'query'), shippingController.getServiceability);

router.get('/tracking/:trackingNumber', optionalAuthenticate, shippingController.getShipmentByTracking);
router.post(
  '/tracking/:trackingNumber/reschedule',
  authenticate,
  validate(RescheduleDeliverySchema),
  shippingController.rescheduleDelivery,
);

router.get('/zones', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.listZones);
router.post('/zones', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(CreateZoneSchema), shippingController.createZone);
router.patch('/zones/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(UpdateZoneSchema), shippingController.updateZone);
router.delete('/zones/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.deleteZone);

router.get(['/rates/admin', '/admin/rates'], authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.listAdminRates);
router.post('/rates', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(CreateRateSchema), shippingController.createRate);
router.patch('/rates/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(UpdateRateSchema), shippingController.updateRate);
router.delete('/rates/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.deleteRate);

// Admin: move a shipment on by hand (delivered, failed attempt, RTO) and the RTO queue.
router.get('/admin/rto-shipments', authenticate, authorize(PERMISSIONS.ORDER_MANAGE), shippingController.adminRtoQueue);
router.patch(
  '/admin/shipments/:shipmentId/status',
  authenticate,
  authorize(PERMISSIONS.ORDER_MANAGE),
  validate(AdminShipmentStatusSchema),
  shippingController.adminUpdateShipmentStatus,
);

router.post('/webhooks/:carrier', shippingController.processWebhook);

export default router;
