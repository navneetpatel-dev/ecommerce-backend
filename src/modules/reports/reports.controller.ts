import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import {
  buildDatedExportFilename,
  documentKeyToPdfTitle,
} from '@core/export/exportFilenames';
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
  type ReportRangeQuery,
} from './reports.dto';
import { buildReportFilename } from './engine/excelExporter';
import {
  contentTypeForFormat,
  extensionForFormat,
  type ReportExportFormat,
} from './engine/csvExporter';
import { reportEngine, type ReportActor } from './engine/reportEngine';
import type { PermissionKey } from '@core/permissions/permissionKeys';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';

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

async function sendExport(
  res: Response,
  query: ReportRangeQuery,
  documentKey: string,
  payload: unknown,
  rows: Record<string, unknown>[],
  suffix?: string | null,
) {
  if (query.format === 'csv') {
    const filename = buildDatedExportFilename(documentKey, query.from, query.to, 'csv', suffix);
    const csv = reportsService.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
    return;
  }
  if (query.format === 'pdf') {
    const filename = buildDatedExportFilename(documentKey, query.from, query.to, 'pdf', suffix);
    const pdf = await reportsService.toPdf(documentKeyToPdfTitle(documentKey), rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
    return;
  }
  res.json(ok(payload));
}

function flattenRecord(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (prefix: string, node: unknown) => {
    if (node && typeof node === 'object' && !Array.isArray(node) && !(node instanceof Date)) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(prefix ? `${prefix}.${key}` : key, child);
      }
      return;
    }
    out[prefix] = node instanceof Date ? node.toISOString() : node;
  };
  walk('', value);
  return out;
}

export const adminSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminSummary(query);
  sendExport(res, query, 'admin-dashboard-summary', data, [flattenRecord(data)]);
});

export const adminVendors = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminVendorSettlements(query);
  sendExport(res, query, 'admin-vendor-settlements', data, data.vendors as unknown as Record<string, unknown>[]);
});

export const adminReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminReconciliation(query);
  sendExport(res, query, 'admin-reconciliation', data, [flattenRecord(data)]);
});

export const vendorSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const vendorId = req.params.vendorId!;
  const data = await reportsService.vendorSummary(vendorId, query, req.user?.vendorId ?? null);
  sendExport(
    res,
    query,
    'vendor-settlement-summary',
    data,
    [flattenRecord(data)],
    vendorId.slice(0, 8),
  );
});

export const walletLiability = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const exportAll = query.format !== 'json';
  const data = await reportsService.walletLiabilityReport({
    ...query,
    page: exportAll ? 1 : (query.page ?? 1),
    limit: exportAll ? 100_000 : (query.limit ?? 50),
  });
  sendExport(res, query, 'admin-wallet-liability', data, data.rows as unknown as Record<string, unknown>[]);
});

export const cashbackWriteOff = asyncHandler(async (req: Request, res: Response) => {
  const query = WriteOffReportSchema.parse(req.query);
  const exportAll = query.format !== 'json';
  const data = await reportsService.cashbackWriteOffReport({
    ...query,
    page: exportAll ? 1 : (query.page ?? 1),
    limit: exportAll ? 100_000 : (query.limit ?? 50),
  });
  sendExport(
    res,
    query,
    'admin-cashback-write-offs',
    data,
    data.rows as unknown as Record<string, unknown>[],
    query.bornBy?.toLowerCase() ?? null,
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
    const exported = await reportEngine.runExport(actor, reportType, filters, query.format);
    if (exported.async) {
      res.json(
        ok({
          async: true,
          exportId: exported.exportId,
          status: exported.status,
          rowCount: exported.rowCount,
        }),
      );
      return;
    }
    const contentType =
      query.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : query.format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.buffer);
    return;
  }

  const data = await reportEngine.runJson(actor, reportType, filters);
  res.json(ok(data));
});

export const downloadExport = asyncHandler(async (req: Request, res: Response) => {
  const actor = await actorFromReq(req);
  const result = await reportEngine.getExportForDownload(actor, req.params.id!);
  if (result.mode === 'redirect') {
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
  const data = await reportEngine.getExportStatus(actor, req.params.id!);
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
    const exported = await reportEngine.runExport(
      actor,
      'customer-order-history',
      filters,
      query.format,
    );
    if (exported.async) {
      res.json(ok(exported));
      return;
    }
    const contentType =
      query.format === 'csv'
        ? 'text/csv; charset=utf-8'
        : query.format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.buffer);
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
