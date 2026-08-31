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
import { buildReportFilename } from './engine/excelExporter';
import {
  contentTypeForFormat,
  extensionForFormat,
  type ReportExportFormat,
} from './engine/csvExporter';
import { reportEngine, type ReportActor } from './engine/reportEngine';
import type { ReportFilters } from './engine/types';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
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
  return 'pdf';
}

async function enqueuePanelExport(
  res: Response,
  actor: ReportActor,
  reportType: string,
  filters: ReportFilters,
  format: ReportExportFormat,
  options?: { bornBy?: string | null },
) {
  const exported = await reportEngine.runExport(
    actor,
    reportType,
    filters,
    format,
    options?.bornBy ? { bornBy: options.bornBy } : {},
  );
  res.json(
    ok({
      async: true,
      exportId: exported.exportId,
      status: exported.status,
      format: exported.format,
      rowCount: exported.rowCount,
      rowCountKnown: exported.rowCountKnown,
      cached: exported.cached ?? false,
    }),
  );
}

export const adminSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await enqueuePanelExport(
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
    await enqueuePanelExport(res, actor, 'vendor-settlement', {
      from: query.from,
      to: query.to,
    }, panelExportFormat(query.format));
    return;
  }
  const data = await reportsService.adminVendorSettlements(query);
  res.json(ok(data));
});

export const adminReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await enqueuePanelExport(res, actor, 'reconciliation', {
      from: query.from,
      to: query.to,
    }, panelExportFormat(query.format));
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
    await enqueuePanelExport(res, actor, 'vendor-summary', {
      from: query.from,
      to: query.to,
      vendorId,
    }, panelExportFormat(query.format));
    return;
  }
  const data = await reportsService.vendorSummary(vendorId, query, req.user?.vendorId ?? null);
  res.json(ok(data));
});

export const walletLiability = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await enqueuePanelExport(res, actor, 'wallet-liability', {
      from: query.from,
      to: query.to,
    }, panelExportFormat(query.format));
    return;
  }
  const data = await reportsService.walletLiabilityReport({
    ...query,
    page: query.page ?? 1,
    limit: query.limit ?? 50,
  });
  res.json(ok(data));
});

export const cashbackWriteOff = asyncHandler(async (req: Request, res: Response) => {
  const query = WriteOffReportSchema.parse(req.query);
  if (query.format !== 'json') {
    const actor = await actorFromReq(req);
    await enqueuePanelExport(
      res,
      actor,
      'cashback-write-offs',
      {
        from: query.from,
        to: query.to,
        bornBy: query.bornBy ?? null,
      },
      panelExportFormat(query.format),
      { bornBy: query.bornBy ?? null },
    );
    return;
  }
  const data = await reportsService.cashbackWriteOffReport({
    ...query,
    page: query.page ?? 1,
    limit: query.limit ?? 50,
  });
  res.json(ok(data));
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
    const exported = await reportEngine.runExport(actor, reportType, filters, query.format);
    res.json(
      ok({
        async: true,
        exportId: exported.exportId,
        status: exported.status,
        format: exported.format,
        rowCount: exported.rowCount,
        rowCountKnown: exported.rowCountKnown,
        cached: exported.cached ?? false,
      }),
    );
    return;
  }

  const data = await reportEngine.runJson(actor, reportType, filters);
  res.json(ok(data));
});

export const downloadExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const result = await reportEngine.getExportForDownload(actor, req.params.id!);
  if (result.mode === 'presigned' || result.mode === 'redirect') {
    res.redirect(result.url);
    return;
  }
  const filters = result.log.filtersUsed as Record<string, unknown>;
  const exportFormat = (result.log.format as ReportExportFormat) || 'xlsx';
  const name = buildReportFilename(
    result.log.reportType,
    new Date(String(filters.from)),
    new Date(String(filters.to)),
    extensionForFormat(exportFormat),
  );
  res.setHeader('Content-Type', contentTypeForFormat(exportFormat));
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(result.buffer);
});

export const exportStatus = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const ifNoneMatch = req.header('if-none-match') ?? null;
  const data = await reportEngine.getExportStatus(actor, req.params.id!, ifNoneMatch);
  if ('notModified' in data) {
    res.status(304).end();
    return;
  }
  res.setHeader('ETag', data.etag);
  res.json(ok(data));
});

export const listAdminExports = asyncHandler(async (req: Request, res: Response) => {
  await actorFromReq(req);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const reportType = typeof req.query.reportType === 'string' ? req.query.reportType : undefined;
  const rows = await reportEngine.listRecentExports(100, { status, reportType });
  const { readReportExportQueueDepth } = await import('./reportExportMetrics');
  const queue = await readReportExportQueueDepth();
  res.json(ok({ rows, queue }));
});

export const retryAdminExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const exported = await reportEngine.retryExport(actor, req.params.id!, { asOriginalUser: true });
  res.json(ok({ ...exported, async: true }));
});

export const retryExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const exported = await reportEngine.retryExport(actor, req.params.id!);
  res.json(ok({ ...exported, async: true }));
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
    const exported = await reportEngine.runExport(
      actor,
      'customer-order-history',
      filters,
      query.format,
    );
    res.json(ok({ ...exported, async: true }));
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
