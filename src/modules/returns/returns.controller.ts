import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { pageLimitQuerySchema } from '@core/http/pagination';
import { returnsService } from './returns.service';
import {
  getCreditNotePdfForActor,
  getDebitNotePdfForActor,
} from '@modules/reports/notePdf.service';
import { CreditNote } from '@database/models/creditNote.model';
import { DebitNote } from '@database/models/debitNote.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ADMIN_ROLES } from '@core/constants/statuses';
import { roleNameOf } from '@utils/userRole';

function isAdminActor(req: Request): boolean {
  const name = req.user!.role?.name ?? roleNameOf(req.user as any);
  return (ADMIN_ROLES as readonly string[]).includes(name);
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const created = await returnsService.create(req.user!.id, req.body);
  res.status(201).json(ok(created));
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const items = await returnsService.listForUser(req.user!.id);
  res.json(ok(items));
});

export const listAdmin = asyncHandler(async (req: Request, res: Response) => {
  const query = pageLimitQuerySchema.parse(req.query);
  const result = await returnsService.listAll(query);
  res.json(ok(result.returns, { pagination: result.pagination }));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const item = await returnsService.getById(req.params.id!, {
    id: req.user!.id,
    roleId: req.user!.roleId,
    role: req.user!.role,
  });
  res.json(ok(item));
});

export const transition = asyncHandler(async (req: Request, res: Response) => {
  const updated = await returnsService.transition(
    req.params.id!,
    req.body.status,
    req.user!.id,
    req.body.rejectionReason,
  );
  res.json(ok(updated));
});

export const reschedulePickup = asyncHandler(async (req: Request, res: Response) => {
  const updated = await returnsService.reschedulePickup(req.params.id!, req.user!.id, req.body.slot);
  res.json(ok(updated));
});

export const retryRefund = asyncHandler(async (req: Request, res: Response) => {
  await returnsService.retryRazorpayRefund(req.params.id!, req.user!.id);
  const item = await returnsService.getById(req.params.id!, {
    id: req.user!.id,
    roleId: req.user!.roleId,
    role: req.user!.role,
  });
  res.json(ok(item));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await returnsService.delete(req.params.id!, req.user!.id);
  res.status(204).send();
});

export const downloadCreditNote = asyncHandler(async (req: Request, res: Response) => {
  const returnId = req.params.id!;
  const note = await CreditNote.findOne({ where: { returnRequestId: returnId } });
  if (!note) throw new NotFoundError('CreditNote');
  const { buffer, filename } = await getCreditNotePdfForActor({
    noteId: note.id,
    userId: req.user!.id,
    vendorId: req.user!.vendorId,
    isAdmin: isAdminActor(req),
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

export const downloadDebitNote = asyncHandler(async (req: Request, res: Response) => {
  const returnId = req.params.id!;
  const note = await DebitNote.findOne({ where: { returnRequestId: returnId } });
  if (!note) throw new NotFoundError('DebitNote');
  const { buffer, filename } = await getDebitNotePdfForActor({
    noteId: note.id,
    vendorId: req.user!.vendorId,
    isAdmin: isAdminActor(req),
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});
