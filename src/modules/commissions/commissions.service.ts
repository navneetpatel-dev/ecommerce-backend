import { CommissionLedger } from '@database/models/commissionLedger.model';
import { CommissionInvoice } from '@database/models/commissionInvoice.model';
import { Vendor } from '@database/models/vendor.model';
import { NotFoundError } from '@core/errors/NotFoundError';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { buildPaginationMeta, paginationOffset } from '@core/http/pagination';
import { renderCommissionInvoicePdf } from './commissionInvoice.service';

function serializeCommission(row: CommissionLedger) {
  const plain: any = typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row;
  const { Vendor: vendorAssoc, ...rest } = plain;
  return {
    ...rest,
    saleAmount: Number(plain.saleAmount),
    commissionRate: Number(plain.commissionRate),
    commissionAmount: Number(plain.commissionAmount),
    vendorName: vendorAssoc?.businessName ?? null,
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
    return {
      commissions: rows.map((row) => serializeCommission(row)),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }

  async listByVendor(vendorId: string) {
    const rows = await CommissionLedger.findAll({
      where: { vendorId },
      include: [vendorInclude],
    });
    return rows.map((row) => serializeCommission(row));
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
      throw new ForbiddenError('Not your commission invoice');
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
          taxablePaise: Number(plain.taxablePaise),
          gstPaise: Number(plain.gstPaise),
          totalPaise: Number(plain.totalPaise),
          issuedAt: plain.issuedAt,
        };
      }),
      pagination: buildPaginationMeta(count, query.page, query.limit),
    };
  }
}

export const commissionsService = new CommissionsService();
