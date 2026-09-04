import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { deliveryAgentsService } from './deliveryAgents.service';
import { deliveryAgentPayoutsService } from './deliveryAgentPayouts.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.list(req.query as any);
  res.json(ok(result.agents, { pagination: result.pagination }));
});

export const performanceReport = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const report = await deliveryAgentsService.performanceReport({ from: fromDate, to: toDate });
  res.json(ok(report));
});

export const staleTasks = asyncHandler(async (_req: Request, res: Response) => {
  const result = await deliveryAgentsService.staleTasks();
  res.json(ok(result));
});

export const unassignedShipments = asyncHandler(async (_req: Request, res: Response) => {
  const shipments = await deliveryAgentsService.unassignedShipments();
  res.json(ok(shipments));
});

export const unassignedPickups = asyncHandler(async (_req: Request, res: Response) => {
  const pickups = await deliveryAgentsService.unassignedPickups();
  res.json(ok(pickups));
});

export const bulkAssignShipments = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.bulkAssignShipments(req.body, req.user!.id);
  res.json(ok(result));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const agent = await deliveryAgentsService.create(req.body, req.user!.id);
  res.status(201).json(ok(agent));
});

export const bulkCreate = asyncHandler(async (req: Request, res: Response) => {
  const results = await deliveryAgentsService.bulkCreate(req.body.rows, req.user!.id);
  res.status(201).json(ok(results));
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

export const delivery = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.delivery(req.params.shipmentId!, req.user!.deliveryAgentId!);
  res.json(ok(shipment));
});

export const updateLocation = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.updateLocation(
    req.user!.deliveryAgentId!,
    req.body.lat,
    req.body.lng,
  );
  res.json(ok(result));
});

export const shiftSummary = asyncHandler(async (req: Request, res: Response) => {
  const summary = await deliveryAgentsService.shiftSummary(req.user!.deliveryAgentId!);
  res.json(ok(summary));
});

export const requestRtoHandoverCode = asyncHandler(async (req: Request, res: Response) => {
  const result = await deliveryAgentsService.requestRtoHandoverCode(
    req.params.shipmentId!,
    req.user!.deliveryAgentId!,
  );
  res.json(ok(result));
});

export const confirmRtoHandover = asyncHandler(async (req: Request, res: Response) => {
  const shipment = await deliveryAgentsService.confirmRtoHandover(
    req.params.shipmentId!,
    req.user!.deliveryAgentId!,
    req.user!.id,
    req.body.otpCode,
  );
  res.json(ok(shipment));
});

export const adminRtoQueue = asyncHandler(async (_req: Request, res: Response) => {
  const shipments = await deliveryAgentsService.adminRtoQueue();
  res.json(ok(shipments));
});

export const closeCashShift = asyncHandler(async (req: Request, res: Response) => {
  const deposit = await deliveryAgentsService.closeCashShift(
    req.user!.deliveryAgentId!,
    req.body.amount,
    req.body.note,
    req.user!.id,
  );
  res.status(201).json(ok(deposit));
});

export const myCashDeposits = asyncHandler(async (req: Request, res: Response) => {
  const deposits = await deliveryAgentsService.myCashDeposits(req.user!.deliveryAgentId!);
  res.json(ok(deposits));
});

export const adminListCashDeposits = asyncHandler(async (req: Request, res: Response) => {
  const deposits = await deliveryAgentsService.adminListCashDeposits(req.query.status as string | undefined);
  res.json(ok(deposits));
});

export const verifyCashDeposit = asyncHandler(async (req: Request, res: Response) => {
  const deposit = await deliveryAgentsService.verifyCashDeposit(
    req.params.depositId!,
    req.user!.id,
    req.body.action,
    req.body.rejectionReason,
  );
  res.json(ok(deposit));
});

export const adminListAgentPayouts = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await deliveryAgentPayoutsService.list(query);
  res.json(ok(result.payouts, { pagination: result.pagination }));
});

export const processAgentPayouts = asyncHandler(async (req: Request, res: Response) => {
  const payouts = await deliveryAgentPayoutsService.process(req.user!.id);
  res.status(201).json(ok(payouts));
});

export const markAgentPayoutPaid = asyncHandler(async (req: Request, res: Response) => {
  const payout = await deliveryAgentPayoutsService.markPaid(req.params.payoutId!, req.user!.id, req.body);
  res.json(ok(payout));
});

export const markAgentPayoutFailed = asyncHandler(async (req: Request, res: Response) => {
  const payout = await deliveryAgentPayoutsService.markFailed(req.params.payoutId!, req.user!.id, req.body);
  res.json(ok(payout));
});

export const retryAgentPayout = asyncHandler(async (req: Request, res: Response) => {
  const payout = await deliveryAgentPayoutsService.retry(req.params.payoutId!, req.user!.id);
  res.json(ok(payout));
});

export const myPayouts = asyncHandler(async (req: Request, res: Response) => {
  const payouts = await deliveryAgentPayoutsService.listForAgent(req.user!.deliveryAgentId!);
  res.json(ok(payouts));
});

export const myPayoutStatement = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, filename } = await deliveryAgentPayoutsService.renderStatement(
    req.params.payoutId!,
    req.user!.deliveryAgentId!,
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const adminPayoutStatement = asyncHandler(async (req: Request, res: Response) => {
  const { buffer, filename } = await deliveryAgentPayoutsService.renderStatement(
    req.params.payoutId!,
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const myEarnings = asyncHandler(async (req: Request, res: Response) => {
  const earnings = await deliveryAgentPayoutsService.earningsForAgent(req.user!.deliveryAgentId!);
  res.json(ok(earnings));
});

export const submitDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await deliveryAgentsService.submitDocument(req.user!.deliveryAgentId!, req.body);
  res.status(201).json(ok(document));
});

export const myDocuments = asyncHandler(async (req: Request, res: Response) => {
  const documents = await deliveryAgentsService.myDocuments(req.user!.deliveryAgentId!);
  res.json(ok(documents));
});

export const adminListDocuments = asyncHandler(async (_req: Request, res: Response) => {
  const documents = await deliveryAgentsService.adminListDocuments();
  res.json(ok(documents));
});

export const reviewDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await deliveryAgentsService.reviewDocument(
    req.params.documentId!,
    req.user!.id,
    req.body,
  );
  res.json(ok(document));
});

export const updateMyBankDetails = asyncHandler(async (req: Request, res: Response) => {
  const bankDetails = await deliveryAgentPayoutsService.updateBankDetails(
    req.user!.deliveryAgentId!,
    req.body,
    req.user!.id,
  );
  res.json(ok(bankDetails));
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

export const pickup = asyncHandler(async (req: Request, res: Response) => {
  const row = await deliveryAgentsService.pickup(req.params.returnId!, req.user!.deliveryAgentId!);
  res.json(ok(row));
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
