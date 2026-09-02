import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { reportsService } from './reports.service';
import {
  getCustomerOrderInvoices,
  getCustomerSubOrderInvoice,
  getVendorSubOrderInvoice,
} from './taxInvoice.service';
import {
  ReportRangeSchema,
  WriteOffReportSchema,
  EngineReportQuerySchema,
  CustomerOrderHistorySchema,
} from './reports.dto';
import { type ReportExportFormat } from './engine/csvExporter';
import { reportEngine, type ReportActor } from './engine/reportEngine';
import type { ReportFilters } from './engine/types';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';

function rangeFromQuery(req: Request) {
  return ReportRangeSchema.parse(req.query);
}

async function actorFromReq(req: Request): Promise<ReportActor> {
  const user = req.user!;
  const roleName = user.role?.name ?? roleNameOf(user as any);
  const permissions = (await resolvePermissionsForUser({
    roleId: user.roleId,
    role: { name: roleName },
  })) as PermissionKey[];
  return {
    id: user.id,
    vendorId: user.vendorId ?? null,
    roleName,
    permissions,
  };
}

function panelExportFormat(format: string): ReportExportFormat {
  if (format === 'csv' || format === 'pdf' || format === 'xlsx') return format;
  throw new ValidationError(`Unsupported export format: ${format}`);
}

async function sendExportFile(
  res: Response,
  actor: ReportActor,
  reportType: string,
  filters: ReportFilters,
  format: ReportExportFormat,
) {
  const result = await reportEngine.runExportDirect(actor, reportType, filters, format);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
}

export const adminSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'admin-dashboard-summary',
      { from: query.from, to: query.to },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.adminSummary(query);
  res.json(ok(data));
});

export const adminVendors = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'vendor-settlement',
      { from: query.from, to: query.to },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.adminVendorSettlements(query);
  res.json(ok(data));
});

export const adminReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'reconciliation',
      { from: query.from, to: query.to },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.adminReconciliation(query);
  res.json(ok(data));
});

export const vendorSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const vendorId = req.params.vendorId!;
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'vendor-summary',
      { from: query.from, to: query.to, vendorId },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.vendorSummary(vendorId, query, req.user?.vendorId ?? null);
  res.json(ok(data));
});

export const walletLiability = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'wallet-liability',
      { from: query.from, to: query.to },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.walletLiabilityReport({
    ...query,
    page: query.page ?? 1,
    limit: query.limit ?? 50,
  });
  res.json(ok(data));
});

export const walletRecharge = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await sendExportFile(
      res,
      actor,
      'wallet-recharge',
      { from: query.from, to: query.to },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportsService.walletRechargeReport({
    ...query,
    page: query.page ?? 1,
    limit: query.limit ?? 50,
  });
  res.json(ok(data));
});

export const cashbackWriteOff = asyncHandler(async (req: Request, res: Response) => {
  const query = WriteOffReportSchema.parse(req.query);
  const actor = await actorFromReq(req);
  if (query.format !== 'json') {
    await sendExportFile(
      res,
      actor,
      'cashback-write-offs',
      {
        from: query.from,
        to: query.to,
        bornBy: query.bornBy ?? null,
      },
      panelExportFormat(query.format),
    );
    return;
  }
  const data = await reportEngine.runJson(actor, 'cashback-write-offs', {
    from: query.from,
    to: query.to,
    bornBy: query.bornBy ?? null,
    page: query.page ?? 1,
    limit: query.limit ?? 50,
  });
  const meta = (data.meta ?? {}) as Record<string, unknown>;
  res.json(
    ok({
      from: query.from,
      to: query.to,
      bornBy: query.bornBy ?? null,
      recoveredTotal: Number(meta.recoveredTotal ?? 0),
      writtenOffTotal: Number(meta.writtenOffTotal ?? 0),
      rows: data.rows,
      pagination: data.pagination,
    }),
  );
});

export const catalog = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const items = reportEngine.catalog(actor).map((d) => ({
    type: d.type,
    labelKey: d.labelKey,
    audience: d.audience,
    financial: d.financial,
    vendorScoped: d.vendorScoped,
    columns: d.columns,
  }));
  res.json(ok(items));
});

export const runReport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const query = EngineReportQuerySchema.parse(req.query);
  const reportType = req.params.type!;
  const filters = {
    from: query.from,
    to: query.to,
    vendorId: query.vendorId ?? null,
    categoryId: query.categoryId ?? null,
    status: query.status ?? null,
    bornBy: query.bornBy ?? null,
    page: query.page,
    limit: query.limit,
  };

  if (query.format === 'xlsx' || query.format === 'csv' || query.format === 'pdf') {
    await sendExportFile(res, actor, reportType, filters, query.format);
    return;
  }

  const data = await reportEngine.runJson(actor, reportType, filters);
  res.json(ok(data));
});

export const customerOrderHistory = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const query = CustomerOrderHistorySchema.parse(req.query);
  const filters = {
    from: query.from,
    to: query.to,
    page: query.page,
    limit: query.limit,
    userId: actor.id,
  };
  if (query.format === 'xlsx' || query.format === 'csv' || query.format === 'pdf') {
    await sendExportFile(res, actor, 'customer-order-history', filters, query.format);
    return;
  }
  const data = await reportEngine.runJson(actor, 'customer-order-history', filters);
  res.json(ok(data));
});

export const customerOrderInvoice = asyncHandler(async (req: Request, res: Response) => {
  const result = await getCustomerOrderInvoices({
    userId: req.user!.id,
    orderId: req.params.orderId!,
  });
  if (result.mode === 'zip') {
    res.setHeader('Content-Type', 'application/zip');
  } else {
    res.setHeader('Content-Type', 'application/pdf');
  }
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.buffer);
});

export const customerOrderSubInvoice = asyncHandler(async (req: Request, res: Response) => {
  const result = await getCustomerSubOrderInvoice({
    userId: req.user!.id,
    orderId: req.params.orderId!,
    subOrderId: req.params.subOrderId!,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.pdf);
});

export const vendorSubOrderInvoice = asyncHandler(async (req: Request, res: Response) => {
  const vendorId = req.user!.vendorId;
  if (!vendorId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
  }
  const result = await getVendorSubOrderInvoice({
    vendorId,
    subOrderId: req.params.subOrderId!,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.pdf);
});
