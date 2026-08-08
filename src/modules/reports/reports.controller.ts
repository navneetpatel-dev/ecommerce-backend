import type { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import { asyncHandler } from '@core/http/asyncHandler';
import { ok } from '@core/http/ApiResponse';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { resolvePermissionsForUser } from '@middleware/rbac.middleware';
import { roleNameOf } from '@utils/userRole';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { Address } from '@database/models/address.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { TaxRule } from '@database/models/taxRule.model';
import { sequelize } from '@database/models';
import { DOCUMENT_SEQUENCE_KIND } from '@core/constants/statuses';
import { nextDocumentNumber } from '@modules/pricing/documentSequence';
import { reportsService } from './reports.service';
import { TAX_INVOICE_COPY } from './reports.constants';
import {
  ReportRangeSchema,
  WriteOffReportSchema,
  EngineReportQuerySchema,
  CustomerOrderHistorySchema,
} from './reports.dto';
import { reportEngine, type ReportActor } from './engine/reportEngine';
import type { PermissionKey } from '@core/permissions/permissionKeys';

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
    const pdf = await reportsService.toPdf(filenameBase, rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.pdf"`);
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

export const walletLiability = asyncHandler(async (req: Request, res: Response) => {
  const query = rangeFromQuery(req);
  const exportAll = query.format !== 'json';
  const data = await reportsService.walletLiabilityReport({
    ...query,
    page: exportAll ? 1 : (query.page ?? 1),
    limit: exportAll ? 100_000 : (query.limit ?? 50),
  });
  sendExport(res, query, 'wallet-liability', data, data.rows as unknown as Record<string, unknown>[]);
});

export const cashbackWriteOff = asyncHandler(async (req: Request, res: Response) => {
  const query = WriteOffReportSchema.parse(req.query);
  const exportAll = query.format !== 'json';
  const data = await reportsService.cashbackWriteOffReport({
    ...query,
    page: exportAll ? 1 : (query.page ?? 1),
    limit: exportAll ? 100_000 : (query.limit ?? 50),
  });
  sendExport(res, query, 'cashback-write-off', data, data.rows as unknown as Record<string, unknown>[]);
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

  if (query.format === 'xlsx') {
    const exported = await reportEngine.runExport(actor, reportType, filters);
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
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
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
  const name = `${result.log.reportType}_${result.log.id}.xlsx`;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
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
  if (query.format === 'xlsx') {
    const exported = await reportEngine.runExport(actor, 'customer-order-history', filters);
    if (exported.async) {
      res.json(ok(exported));
      return;
    }
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    res.send(exported.buffer);
    return;
  }
  const data = await reportEngine.runJson(actor, 'customer-order-history', filters);
  res.json(ok(data));
});

export const customerOrderInvoice = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const orderId = req.params.orderId!;
  const order = await Order.findByPk(orderId, {
    include: [
      { model: Address, as: 'shippingAddress' },
      {
        model: SubOrder,
        as: 'subOrders',
        include: [
          { model: Vendor, as: 'vendor' },
          {
            model: OrderItem,
            as: 'items',
            include: [
              {
                model: ProductVariant,
                as: 'variant',
                include: [{ model: Product, as: 'product', attributes: ['id', 'categoryId', 'name'] }],
              },
            ],
          },
        ],
      },
    ],
  });
  if (!order) throw new NotFoundError('Order');
  if (order.userId !== userId) {
    throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_ORDER);
  }

  const categoryIds = new Set<string>();
  for (const sub of (order as any).subOrders ?? []) {
    for (const item of sub.items ?? []) {
      const catId = item.variant?.product?.categoryId;
      if (catId) categoryIds.add(catId);
    }
  }
  const taxRules = categoryIds.size
    ? await TaxRule.findAll({ where: { categoryId: [...categoryIds] as any } })
    : [];
  const hsnByCategory = new Map(taxRules.map((r) => [r.categoryId, r.hsnCode ?? '']));

  let invoiceNo = order.taxInvoiceNumber;
  if (!invoiceNo) {
    invoiceNo = await sequelize.transaction(async (t) => {
      const locked = await Order.findByPk(order.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) throw new NotFoundError('Order');
      if (locked.taxInvoiceNumber) return locked.taxInvoiceNumber;
      const number = await nextDocumentNumber(DOCUMENT_SEQUENCE_KIND.TAX_INVOICE, t);
      await locked.update(
        { taxInvoiceNumber: number, updatedBy: userId },
        { transaction: t },
      );
      return number;
    });
  }

  const copy = TAX_INVOICE_COPY;
  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(16).text(copy.title, { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`${copy.invoiceNo}: ${invoiceNo}`);
  doc.text(`${copy.orderId}: ${order.id}`);
  doc.text(`${copy.invoiceDate}: ${order.createdAt.toISOString().slice(0, 10)}`);
  doc.text(`${copy.payment}: ${order.paymentMethod ?? ''} / ${order.paymentStatus}`);

  const addr = (order as any).shippingAddress as Address | undefined;
  if (addr) {
    doc.moveDown();
    doc.fontSize(11).text(copy.placeOfSupply);
    doc.fontSize(10).text(`${addr.line1}${addr.line2 ? `, ${addr.line2}` : ''}`);
    doc.text(`${addr.city}, ${addr.state} ${addr.pincode}, ${addr.country}`);
  }

  let grandCgst = 0;
  let grandSgst = 0;
  let grandIgst = 0;
  let grandTaxable = 0;

  for (const sub of (order as any).subOrders ?? []) {
    const vendor = sub.vendor as Vendor | undefined;
    doc.moveDown();
    doc.fontSize(11).text(`${copy.seller}: ${vendor?.businessName ?? copy.platformSeller}`);
    if (vendor?.gstNumber) doc.fontSize(10).text(`${copy.gstin}: ${vendor.gstNumber}`);
    if (vendor?.state) doc.fontSize(10).text(`${copy.sellerState}: ${vendor.state}`);

    for (const item of sub.items ?? []) {
      const tb = (item.taxBreakdown ?? {}) as Record<string, number>;
      const cgst = Number(tb.cgst ?? 0);
      const sgst = Number(tb.sgst ?? 0);
      const igst = Number(tb.igst ?? 0);
      const taxable = Number(item.taxableAmount ?? 0);
      const catId = item.variant?.product?.categoryId as string | undefined;
      const hsn = catId ? hsnByCategory.get(catId) ?? '' : '';
      grandCgst += cgst;
      grandSgst += sgst;
      grandIgst += igst;
      grandTaxable += taxable;
      doc.fontSize(9).text(
        `${item.productName} | ${copy.hsn} ${hsn || copy.emptyValue} | ${copy.qty} ${item.quantity} | ${copy.taxable} ${copy.currencyPrefix}${taxable.toFixed(2)} | ${copy.cgst} ${copy.currencyPrefix}${cgst.toFixed(2)} ${copy.sgst} ${copy.currencyPrefix}${sgst.toFixed(2)} ${copy.igst} ${copy.currencyPrefix}${igst.toFixed(2)}`,
      );
    }
  }

  doc.moveDown();
  doc.fontSize(10).text(`${copy.taxableTotal}: ${copy.currencyPrefix}${grandTaxable.toFixed(2)}`);
  doc.text(
    `${copy.cgst}: ${copy.currencyPrefix}${grandCgst.toFixed(2)}  ${copy.sgst}: ${copy.currencyPrefix}${grandSgst.toFixed(2)}  ${copy.igst}: ${copy.currencyPrefix}${grandIgst.toFixed(2)}`,
  );
  doc.fontSize(12).text(
    `${copy.grandTotal}: ${copy.currencyPrefix}${Number(order.totalAmount).toFixed(2)}`,
  );
  if (Number(order.walletAmountUsed ?? 0) > 0) {
    doc.fontSize(10).text(
      `${copy.walletApplied}: ${copy.currencyPrefix}${Number(order.walletAmountUsed).toFixed(2)}`,
    );
  }
  doc.end();
  const pdf = await done;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="invoice_${order.id.slice(0, 8)}.pdf"`,
  );
  res.send(pdf);
});
