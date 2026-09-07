import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { COOKIES } from '@core/constants/http';
import { shippingService } from './shipping.service';
import { deliveryRatingsService } from '@modules/deliveryAgents/deliveryRatings.service';
import { GetShippingRatesSchema, UpdateRateSchema } from './shipping.dto';

export const getRates = asyncHandler(async (req: Request, res: Response) => {
  const query = GetShippingRatesSchema.parse(req.query);
  const userId = req.user?.id ?? null;
  const sessionId = (req.cookies?.[COOKIES.SESSION_ID] as string | undefined) ?? null;
  const rates = await shippingService.quotePublicRates(query, { userId, sessionId });
  res.json(ok(rates));
});

export const getShipmentByTracking = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await shippingService.getShipmentByTracking(
    req.params.trackingNumber!,
    req.user ?? null,
  );
  res.json(ok(shipment));
});

export const rescheduleDelivery = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await shippingService.rescheduleDelivery(
    req.params.trackingNumber!,
    req.user!.id,
    req.body.slot,
  );
  res.json(ok(shipment));
});

export const listZones = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await shippingService.listZones(query);
  res.json(ok(result.zones, { pagination: result.pagination }));
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
  await shippingService.deleteZone(req.params.id!, req.user!.id);
  res.status(204).send();
});

export const submitDeliveryRating = asyncHandler(async (req: Request, res: Response) => {
  const rating = await deliveryRatingsService.submit(
    req.params.shipmentId!,
    req.user!.id,
    req.body.rating,
    req.body.comment,
  );
  res.status(201).json(ok(rating));
});

export const getDeliveryRating = asyncHandler(async (req: Request, res: Response) => {
  const rating = await deliveryRatingsService.forShipment(req.params.shipmentId!);
  res.json(ok(rating));
});

export const listAdminRates = asyncHandler(async (_req: Request, res: Response) => {
  res.json(ok(await shippingService.listAdminRates()));
});

export const createRate = asyncHandler(async (req: Request, res: Response) => {
  const rate = await shippingService.createRate(req.body, req.user!.id);
  res.status(201).json(ok(rate));
});

export const updateRate = asyncHandler(async (req: Request, res: Response) => {
  const dto = UpdateRateSchema.parse(req.body);
  const rate = await shippingService.updateRate(req.params.id!, dto, req.user!.id);
  res.json(ok(rate));
});

export const deleteRate = asyncHandler(async (req: Request, res: Response) => {
  await shippingService.deleteRate(req.params.id!, req.user!.id);
  res.status(204).send();
});

export const processWebhook = asyncHandler(async (req: Request, res: Response) => {
  const result = await shippingService.handleWebhook(
    req.params.carrier!,
    req.body as Buffer | string,
    req.header('x-shipping-signature'),
    req.header('x-shipping-event-id'),
  );
  res.json(ok(result));
});
