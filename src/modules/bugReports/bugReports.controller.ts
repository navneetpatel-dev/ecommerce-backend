import { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { keysetQuerySchema } from '@core/http/keysetPagination';
import { env } from '@config/env';
import { bugReportsService } from './bugReports.service';
import { AdminBugListQuerySchema, MineBugListQuerySchema } from './bugReports.dto';

function actorFromReq(req: Request) {
  return {
    id: req.user!.id,
    vendorId: req.user!.vendorId,
    roleId: req.user!.roleId,
    role: { name: req.user!.role.name },
  };
}

/** Prefer browser Referer; accept x-page-url only when same-origin as CLIENT_URL. */
function resolvePageUrl(req: Request): string | null {
  let clientOrigin: string | null = null;
  try {
    clientOrigin = new URL(env.CLIENT_URL).origin;
  } catch {
    clientOrigin = null;
  }

  const candidates = [req.get('referer') ?? req.get('referrer'), req.get('x-page-url')];
  for (const raw of candidates) {
    if (!raw || raw.length > 2048) continue;
    try {
      const parsed = new URL(raw);
      if (clientOrigin && parsed.origin !== clientOrigin) continue;
      return parsed.toString().slice(0, 2048);
    } catch {
      continue;
    }
  }
  return null;
}

export const create = asyncHandler(async (req: Request, res: Response) => {
  const created = await bugReportsService.create(
    actorFromReq(req),
    req.body,
    req.body as Record<string, unknown>,
    req.get('user-agent') ?? undefined,
    resolvePageUrl(req),
  );
  res.status(201).json(ok(created));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const query = MineBugListQuerySchema.parse(req.query);
  const result = await bugReportsService.listMine(actorFromReq(req), query);
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const listAdmin = asyncHandler(async (req: Request, res: Response) => {
  const query = AdminBugListQuerySchema.parse(req.query);
  const result = await bugReportsService.listAdmin(query);
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const bug = await bugReportsService.getById(req.params.id!, actorFromReq(req));
  res.json(ok(bug));
});

export const triage = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.triage(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const updateAssignment = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.updateAssignment(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.updateStatus(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const markDuplicate = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.markDuplicate(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const wontFix = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.wontFix(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.json(ok(updated));
});

export const verify = asyncHandler(async (req: Request, res: Response) => {
  const updated = await bugReportsService.verify(req.params.id!, actorFromReq(req));
  res.json(ok(updated));
});

export const addComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await bugReportsService.addComment(
    req.params.id!,
    actorFromReq(req),
    req.body,
  );
  res.status(201).json(ok(comment));
});

export const listComments = asyncHandler(async (req: Request, res: Response) => {
  const query = keysetQuerySchema.parse(req.query);
  const result = await bugReportsService.listComments(
    req.params.id!,
    actorFromReq(req),
    query,
  );
  res.json(ok(result.items, { nextCursor: result.nextCursor }));
});
