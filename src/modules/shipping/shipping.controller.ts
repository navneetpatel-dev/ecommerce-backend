import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { shippingService } from './shipping.service';
import { WebhookPayloadSchema } from './shipping.dto';

export const getRates = asyncHandler(async (req: Request, res: Response) => {
  const rates = await shippingService.getRatesForQuote({
    pincode: String(req.query.pincode),
    weightGrams: Number(req.query.weight),
    method: req.query.method ? String(req.query.method) : undefined,
    state: req.query.state ? String(req.query.state) : undefined,
  });
  res.json(ok(rates));
});

export const getShipmentByTracking = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await shippingService.getShipmentByTracking(req.params.trackingNumber!);
  res.json(ok(shipment));
});

export const listZones = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await shippingService.listZones()));
});

export const createZone = asyncHandler(async (req: Request, res: Response) => {
  const zone = await shippingService.createZone(req.body, req.user!.id);
  res.status(201).json(ok(zone));
});

export const updateZone = asyncHandler(async (req: Request, res: Response) => {
  const zone = await shippingService.updateZone(req.params.id!, req.body, req.user!.id);
  res.json(ok(zone));
});

export const deleteZone = asyncHandler(async (req: Request, res: Response) => {
  await shippingService.deleteZone(req.params.id!);
  res.status(204).send();
});

export const listAdminRates = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await shippingService.listAdminRates()));
});

export const createRate = asyncHandler(async (req: Request, res: Response) => {
  const rate = await shippingService.createRate(req.body, req.user!.id);
  res.status(201).json(ok(rate));
});

export const processWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { trackingNumber, status } = WebhookPayloadSchema.parse(req.body);
  const shipment = await shippingService.processWebhook(trackingNumber, status);
  res.json(ok({ received: true, shipment }));
});
