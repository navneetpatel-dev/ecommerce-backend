import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { keysetQuerySchema } from '@core/http/keysetPagination';
import { supportTicketsService } from './supportTickets.service';
import { AdminTicketListQuerySchema, VendorTicketListQuerySchema } from './supportTickets.dto';

function actorFromReq(req: Request) {
  return {
    id: req.user!.id,
    vendorId: req.user!.vendorId,
    role: { name: req.user!.role.name },
  };
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const created = await supportTicketsService.create(actorFromReq(req), req.body);
  res.status(201).json(ok(created));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const query = keysetQuerySchema.parse(req.query);
  const result = await supportTicketsService.listMine(actorFromReq(req), query);
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const listVendor = asyncHandler(async (req: Request, res: Response) => {
  const query = VendorTicketListQuerySchema.parse(req.query);
  const result = await supportTicketsService.listVendor(actorFromReq(req), query);
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const listAdmin = asyncHandler(async (req: Request, res: Response) => {
  const query = AdminTicketListQuerySchema.parse(req.query);
  const result = await supportTicketsService.listAdmin(query);
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await supportTicketsService.getById(req.params.id!, actorFromReq(req));
  res.json(ok(ticket));
});

export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const query = keysetQuerySchema.parse(req.query);
  const result = await supportTicketsService.listMessages(
    req.params.id!,
    actorFromReq(req),
    query,
  );
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const reply = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.reply(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const resolve = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.resolve(req.params.id!, actorFromReq(req));
  res.json(ok(updated));
});

export const reopen = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.reopen(req.params.id!, actorFromReq(req));
  res.json(ok(updated));
});

export const close = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.close(req.params.id!, actorFromReq(req));
  res.json(ok(updated));
});

export const reassign = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.reassign(
    req.params.id!,
    actorFromReq(req),
    req.body.assignedToId,
  );
  res.json(ok(updated));
});

export const rate = asyncHandler(async (req: Request, res: Response) => {
  const updated = await supportTicketsService.rate(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});
