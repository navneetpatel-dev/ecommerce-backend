import { Op } from 'sequelize';
import { fromPaise } from '@modules/pricing/money';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { TdsLedger } from '@database/models/tdsLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import {
  getGstBreakdownForSubOrders,
  type SubOrderGstBreakdown,
} from '@modules/reports/definitions/vendorOwner';
import { renderCommissionInvoicePdf } from './commissionInvoice.service';

interface SubOrderTdsInfo {
  tdsAmount: number;
  tdsRatePercent: number;
  tdsSection: string;
}

/** Batches a TDS-ledger lookup for a set of subOrderIds (TdsLedger is a separate table, not a CommissionLedger column). */
async function getTdsBySubOrder(subOrderIds: string[]): Promise<Map<string, SubOrderTdsInfo>> {
  const map = new Map<string, SubOrderTdsInfo>();
  if (!subOrderIds.length) return map;
  const rows = await TdsLedger.findAll({ where: { subOrderId: { [Op.in]: subOrderIds } } });
  const paiseBySubOrder = new Map<string, number>();
  for (const row of rows) {
    if (!map.has(row.subOrderId)) {
      map.set(row.subOrderId, { tdsAmount: 0, tdsRatePercent: Number(row.ratePercent), tdsSection: row.section });
    }
    paiseBySubOrder.set(
      row.subOrderId,
      (paiseBySubOrder.get(row.subOrderId) ?? 0) + Number(row.tdsAmountPaise),
    );
  }
  for (const [subOrderId, paise] of paiseBySubOrder) {
    map.get(subOrderId)!.tdsAmount = fromPaise(paise);
  }
  return map;
}

function serializeCommission(
  row: CommissionLedger,
  tdsBySubOrder: Map<string, SubOrderTdsInfo>,
  gstBySubOrder: Map<string, SubOrderGstBreakdown>,
) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const { Vendor: vendorAssoc } = plain;
  const tds = tdsBySubOrder.get(plain.subOrderId);
  const gst = gstBySubOrder.get(plain.subOrderId);
  return {
    id: plain.id,
    vendorId: plain.vendorId,
    subOrderId: plain.subOrderId,
    saleAmount: Number(plain.saleAmount),
    commissionRate: Number(plain.commissionRate),
    commissionAmount: Number(plain.commissionAmount),
    status: plain.status,
    createdAt: plain.createdAt,
    vendorName: vendorAssoc?.businessName ?? null,
    tdsAmount: tds ? tds.tdsAmount : null,
    tdsRatePercent: tds ? tds.tdsRatePercent : null,
    tdsSection: tds ? tds.tdsSection : null,
    gstTaxableAmount: gst ? gst.taxableAmount : null,
    gstAmount: gst ? gst.taxAmount : null,
    gstCgst: gst ? gst.cgst : null,
    gstSgst: gst ? gst.sgst : null,
    gstIgst: gst ? gst.igst : null,
  };
}

const vendorInclude = {
  model: Vendor,
  attributes: ['id', 'businessName'],
};

export class CommissionsService {
  async list(query: { page: number; limit: number }, vendorId?: string | null) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await CommissionLedger.findAndCountAll({
      where: vendorId ? { vendorId } : undefined,
      include: [vendorInclude],
      order: [['createdAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    const subOrderIds = [...new Set(rows.map((row) => row.subOrderId))];
    const [tdsBySubOrder, gstBySubOrder] = await Promise.all([
      getTdsBySubOrder(subOrderIds),
      getGstBreakdownForSubOrders(subOrderIds),
    ]);
    return {
      commissions: rows.map((row) => serializeCommission(row, tdsBySubOrder, gstBySubOrder)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listByVendor(vendorId: string) {
    const rows = await CommissionLedger.findAll({
      where: { vendorId },
      include: [vendorInclude],
    });
    const subOrderIds = [...new Set(rows.map((row) => row.subOrderId))];
    const [tdsBySubOrder, gstBySubOrder] = await Promise.all([
      getTdsBySubOrder(subOrderIds),
      getGstBreakdownForSubOrders(subOrderIds),
    ]);
    return rows.map((row) => serializeCommission(row, tdsBySubOrder, gstBySubOrder));
  }

  async getCommissionInvoicePdf(
    invoiceId: string,
    requesterVendorId?: string | null,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await CommissionInvoice.findByPk(invoiceId, {
      include: [
        {
          model: Vendor,
          as: 'vendor',
          attributes: ['id', 'businessName', 'gstNumber', 'state'],
        },
      ],
    });
    if (!invoice) throw new NotFoundError('CommissionInvoice');
    if (requesterVendorId && requesterVendorId !== invoice.vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_COMMISSION_INVOICE);
    }
    const vendor = (invoice as any).vendor as Vendor | undefined;
    const buffer = await renderCommissionInvoicePdf(invoice, {
      businessName: vendor?.businessName,
      gstNumber: vendor?.gstNumber,
      state: vendor?.state,
    });
    const safe = invoice.number.replace(/\//g, '-').toLowerCase();
    return {
      buffer,
      filename: `commission-invoice_${safe}.pdf`,
    };
  }

  async listInvoices(
    query: { page: number; limit: number },
    vendorId?: string | null,
  ) {
    const offset = paginationOffset(query.page, query.limit);
    const { rows, count } = await CommissionInvoice.findAndCountAll({
      where: vendorId ? { vendorId } : undefined,
      include: [
        {
          model: Vendor,
          as: 'vendor',
          attributes: ['id', 'businessName'],
        },
      ],
      order: [['issuedAt', 'DESC']],
      limit: query.limit,
      offset,
      distinct: true,
      col: 'id',
    });
    return {
      invoices: rows.map((row) => {
        const plain: any = row.get({ plain: true });
        return {
          id: plain.id,
          number: plain.number,
          vendorId: plain.vendorId,
          payoutId: plain.payoutId,
          vendorName: plain.vendor?.businessName ?? null,
          taxableAmount: fromPaise(Number(plain.taxablePaise)),
          gstAmount: fromPaise(Number(plain.gstPaise)),
          totalAmount: fromPaise(Number(plain.totalPaise)),
          issuedAt: plain.issuedAt,
        };
      }),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }
}

export const commissionsService = new CommissionsService();
