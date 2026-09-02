import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '@middleware/auth.middleware';
import { authorize } from '@middleware/rbac.middleware';
import { validate } from '@middleware/validate.middleware';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import {
  GetShippingRatesSchema,
  CreateZoneSchema,
  UpdateZoneSchema,
  CreateRateSchema,
} from './shipping.dto';
import * as shippingController from './shipping.controller';

const router = Router();

router.get(
  '/rates',
  optionalAuthenticate,
  validate(GetShippingRatesSchema, 'query'),
  shippingController.getRates,
);

router.get('/tracking/:trackingNumber', shippingController.getShipmentByTracking);

router.get('/zones', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.listZones);
router.post('/zones', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(CreateZoneSchema), shippingController.createZone);
router.patch('/zones/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(UpdateZoneSchema), shippingController.updateZone);
router.delete('/zones/:id', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.deleteZone);

router.get(['/rates/admin', '/admin/rates'], authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), shippingController.listAdminRates);
router.post('/rates', authenticate, authorize(PERMISSIONS.SHIPPING_MANAGE), validate(CreateRateSchema), shippingController.createRate);

router.post('/webhooks/:carrier', shippingController.processWebhook);

export default router;
