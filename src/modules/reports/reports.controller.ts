import type { Request, Response } from 'express';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { reportsService } from './reports.service';
import { ReportRangeSchema } from './reports.dto';

function rangeFromQuery(req: Request) {
  return ReportRangeSchema.parse(req.query);
}

function sendExport(
  res: Response,
  query: { format: 'json' | 'csv' | 'pdf' },
  filenameBase: string,
  payload: unknown,
  rows: Record<string, unknown>[],
) {
  if (query.format === 'csv') {
    const csv = reportsService.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
    res.send(csv);
    return;
  }
  if (query.format === 'pdf') {
    const html = reportsService.toPrintableHtml(filenameBase, rows);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.html"`);
    res.send(html);
    return;
  }
  res.json(ok(payload));
}

export const adminSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminSummary(query);
  sendExport(res, query, 'admin-summary', data, [flattenRecord(data)]);
});

export const adminVendors = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminVendorSettlements(query);
  sendExport(res, query, 'vendor-settlements', data, data.vendors as unknown as Record<string, unknown>[]);
});

export const adminReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const data = await reportsService.adminReconciliation(query);
  sendExport(res, query, 'reconciliation', data, [flattenRecord(data)]);
});

export const vendorSummary = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const vendorId = req.params.vendorId!;
  const data = await reportsService.vendorSummary(vendorId, query, req.user?.vendorId ?? null);
  sendExport(res, query, 'vendor-settlement', data, [flattenRecord(data)]);
});

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