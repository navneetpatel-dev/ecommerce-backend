import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { deliveryAgentsService } from './deliveryAgents.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.list(req.query as any);
  res.json(ok(result.agents, { pagination: result.pagination }));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const agent = await deliveryAgentsService.create(req.body, req.user!.id);
  res.status(201).json(ok(agent));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const agent = await deliveryAgentsService.update(req.params.id!, req.body, req.user!.id);
  res.json(ok(agent));
});

export const tasks = asyncHandler(async (req: Request, res: Response) => {
  const counts = await deliveryAgentsService.taskCounts(req.params.id!);
  res.json(ok(counts));
});

export const assignShipment = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.assignShipment(req.params.shipmentId!, req.body.deliveryAgentId, req.user!.id);
  res.json(ok(shipment));
});

export const assignPickup = asyncHandler(async (req: Request, res: Response) => {
  const pickup = await deliveryAgentsService.assignPickup(req.params.returnId!, req.body.deliveryAgentId, req.user!.id);
  res.json(ok(pickup));
});

export const profile = asyncHandler(async (req: Request, res: Response) => {
  const agent = await deliveryAgentsService.profile(req.user!.deliveryAgentId!);
  res.json(ok(agent));
});

export const setAvailability = asyncHandler(async (req: Request, res: Response) => {
  const agent = await deliveryAgentsService.setAvailability(req.user!.deliveryAgentId!, req.body.availableForAssignment);
  res.json(ok(agent));
});

export const deliveries = asyncHandler(async (req: Request, res: Response) => {
  const statuses = req.query.status ? String(req.query.status).split(',') : undefined;
  const rows = await deliveryAgentsService.deliveries(req.user!.deliveryAgentId!, statuses);
  res.json(ok(rows));
});

export const updateDeliveryStatus = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.updateDeliveryStatus(req.params.shipmentId!, req.user!.deliveryAgentId!, req.user!.id, req.body);
  res.json(ok(shipment));
});

export const requestDeliveryCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.requestDeliveryCode(req.params.shipmentId!, req.user!.deliveryAgentId!);
  res.json(ok(result));
});

export const confirmDelivery = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.confirmDelivery(req.params.shipmentId!, req.user!.deliveryAgentId!, req.user!.id, req.body);
  res.json(ok(shipment));
});

export const forceConfirmDelivery = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.forceConfirmDelivery(req.params.shipmentId!, req.user!.id, req.body.reason);
  res.json(ok(shipment));
});

export const pickups = asyncHandler(async (req: Request, res: Response) => {
  const statuses = req.query.status ? String(req.query.status).split(',') : undefined;
  const rows = await deliveryAgentsService.pickups(req.user!.deliveryAgentId!, statuses);
  res.json(ok(rows));
});

export const requestPickupCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.requestPickupCode(req.params.returnId!, req.user!.deliveryAgentId!);
  res.json(ok(result));
});

export const updatePickupStatus = asyncHandler(async (req: Request, res: Response) => {
  const pickup = await deliveryAgentsService.updatePickupStatus(req.params.returnId!, req.user!.deliveryAgentId!, req.user!.id, req.body.note);
  res.json(ok(pickup));
});

export const confirmPickup = asyncHandler(async (req: Request, res: Response) => {
  const pickup = await deliveryAgentsService.confirmPickup(req.params.returnId!, req.user!.deliveryAgentId!, req.user!.id, req.body);
  res.json(ok(pickup));
});
