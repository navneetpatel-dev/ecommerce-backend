import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { GetSubOrdersQuerySchema } from './suborders.dto';
import { subordersService } from './suborders.service';
import { retryPartCardRefund } from '@modules/payments/partCardRefund';
import { logAudit } from '@modules/audit/audit.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = GetSubOrdersQuerySchema.parse(req.query);
  const result = await subordersService.list(req.user!.vendorId, query);
  res.json(ok(result.suborders, { pagination: result.pagination }));
});


export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await subordersService.updateStatus(req.params.id!, req.body.status, req.body.trackingId, req.user!.id);
  res.json(ok(updated));
});

/** Admin: retry a cancelled or RTO'd part's failed card refund. */
export const retryRefund = asyncHandler(async (req: Request, res: Response) => {
  const part = await retryPartCardRefund(req.params.id!);
  await logAudit({
    actorId: req.user!.id,
    action: 'SUBORDER_REFUND_RETRIED',
    entityType: 'SubOrder',
    entityId: part.id,
    metadata: { refundStatus: part.cancelRefundStatus, amountPaise: part.cancelRefundAmountPaise },
  });
  res.json(ok({ id: part.id, cancelRefundStatus: part.cancelRefundStatus }));
});
