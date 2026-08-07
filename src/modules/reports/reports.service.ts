import { Op } from 'sequelize';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { DISCOUNT_BEARER, PAYMENT_STATUS, COMMISSION_STATUS } from '@core/constants/statuses';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { WalletLedger } from '@database/models/walletLedger.model';
import { WalletWriteOff } from '@database/models/walletWriteOff.model';
import { toPaise, fromPaise } from '@modules/pricing/money';
import type { ReportRangeQuery, WriteOffReportQuery } from './reports.dto';

function assertRange(query: ReportRangeQuery) {
  if (query.from > query.to) {
    throw new ValidationError(ERROR_MESSAGES.REPORT_INVALID_RANGE);
  }
}

/** Prefer frozen paise columns; fall back to DECIMAL rupees for legacy rows. */
function frozenPaise(paiseValue: unknown, rupeeValue: unknown): number {
  const paise = Number(paiseValue ?? 0);
  const rupees = Number(rupeeValue ?? 0);
  if (paise !== 0) return paise;
  if (rupees === 0) return 0;
  return toPaise(rupees);
}

function paidOrderInclude(from: Date, to: Date) {
  return {
    model: Order,
    as: 'order',
    required: true,
    where: {
      paymentStatus: PAYMENT_STATUS.PAID,
      createdAt: { [Op.between]: [from, to] },
    },
    attributes: ['id', 'totalAmount', 'discountTotal', 'couponId', 'paymentStatus', 'createdAt'],
  };
}

export class ReportsService {
  async adminSummary(query: ReportRangeQuery) {
    assertRange(query);
    const subOrders = await SubOrder.findAll({
      include: [paidOrderInclude(query.from, query.to)],
    });

    // Align commission/TCS/net to the same paid orders (frozen SubOrder period).
    const subOrderIds = subOrders.map((sub) => sub.id);
    const ledgers = subOrderIds.length
      ? await CommissionLedger.findAll({
          where: {
            subOrderId: { [Op.in]: subOrderIds },
            status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
          },
        })
      : [];

    let gmvPaise = 0;
    let taxCollectedPaise = 0;
    let shippingPaise = 0;
    let merchandiseDiscountPaise = 0;

    for (const sub of subOrders) {
      gmvPaise += frozenPaise(sub.subtotalPaise, sub.subtotal);
      taxCollectedPaise += frozenPaise(sub.taxAmountPaise, sub.taxAmount);
      const shippingCostPaise = frozenPaise(sub.shippingCostPaise, sub.shippingCost);
      const shippingDiscountPaise = frozenPaise(
        sub.shippingDiscountAmountPaise,
        sub.shippingDiscountAmount,
      );
      shippingPaise += Math.max(0, shippingCostPaise - shippingDiscountPaise);
      merchandiseDiscountPaise += frozenPaise(sub.discountAmountPaise, sub.discountAmount);
    }

    const orderIds = new Set(
      subOrders
        .map((sub) => (sub as SubOrder & { order?: Order }).order?.id)
        .filter(Boolean) as string[],
    );
    const orders = await Order.findAll({
      where: { id: { [Op.in]: [...orderIds] } },
      attributes: ['id', 'totalAmount', 'discountTotal', 'couponId'],
    });
    const customerPaymentsPaise = orders.reduce(
      (sum, order) => sum + toPaise(order.totalAmount),
      0,
    );

    let commissionPaise = 0;
    let tcsPaise = 0;
    let netPayoutPaise = 0;
    let platformDiscountPaise = 0;
    let vendorDiscountPaise = 0;

    for (const ledger of ledgers) {
      commissionPaise += frozenPaise(ledger.commissionAmountPaise, ledger.commissionAmount);
      tcsPaise += frozenPaise(ledger.tcsAmountPaise, ledger.tcsAmount);
      netPayoutPaise += frozenPaise(
        ledger.netPayoutAmountPaise,
        ledger.netPayoutAmount != null
          ? ledger.netPayoutAmount
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount),
      );
      const disc = frozenPaise(ledger.discountAmountPaise, ledger.discountAmount);
      if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) vendorDiscountPaise += disc;
      else if (ledger.discountBearer === DISCOUNT_BEARER.PLATFORM) platformDiscountPaise += disc;
      else if (disc > 0) platformDiscountPaise += disc;
    }

    return {
      from: query.from,
      to: query.to,
      gmv: fromPaise(gmvPaise),
      customerPayments: fromPaise(customerPaymentsPaise),
      commissionEarned: fromPaise(commissionPaise),
      taxCollected: fromPaise(taxCollectedPaise),
      tcsCollected: fromPaise(tcsPaise),
      shippingCollected: fromPaise(shippingPaise),
      discountAbsorbed: {
        platform: fromPaise(platformDiscountPaise),
        vendor: fromPaise(vendorDiscountPaise),
        merchandiseTotal: fromPaise(merchandiseDiscountPaise),
      },
      vendorNetPayouts: fromPaise(netPayoutPaise),
    };
  }

  async adminVendorSettlements(query: ReportRangeQuery) {
    assertRange(query);
    const ledgers = await CommissionLedger.findAll({
      where: { createdAt: { [Op.between]: [query.from, query.to] } },
      include: [{ model: Vendor, attributes: ['id', 'businessName'] }],
    });

    const byVendor = new Map<
      string,
      {
        vendorId: string;
        vendorName: string;
        grossSales: number;
        discountsAbsorbed: number;
        commissionCharged: number;
        tcsCharged: number;
        netPaidOut: number;
        pendingNet: number;
        settledNet: number;
      }
    >();

    for (const ledger of ledgers) {
      const vendor = (ledger as any).Vendor as Vendor | undefined;
      const key = ledger.vendorId;
      const row = byVendor.get(key) ?? {
        vendorId: key,
        vendorName: vendor?.businessName ?? key,
        grossSales: 0,
        discountsAbsorbed: 0,
        commissionCharged: 0,
        tcsCharged: 0,
        netPaidOut: 0,
        pendingNet: 0,
        settledNet: 0,
      };
      const taxablePaise = frozenPaise(ledger.taxableAmountPaise, ledger.taxableAmount ?? ledger.saleAmount);
      const netPaise = frozenPaise(
        ledger.netPayoutAmountPaise,
        ledger.netPayoutAmount != null
          ? ledger.netPayoutAmount
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount),
      );
      const commissionPaise = frozenPaise(ledger.commissionAmountPaise, ledger.commissionAmount);
      const tcsPaise = frozenPaise(ledger.tcsAmountPaise, ledger.tcsAmount);
      const discPaise = frozenPaise(ledger.discountAmountPaise, ledger.discountAmount);

      row.grossSales += fromPaise(taxablePaise);
      if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) {
        row.discountsAbsorbed += fromPaise(discPaise);
      }
      row.commissionCharged += fromPaise(commissionPaise);
      row.tcsCharged += fromPaise(tcsPaise);
      if (ledger.status === COMMISSION_STATUS.SETTLED) {
        row.settledNet += fromPaise(netPaise);
        row.netPaidOut += fromPaise(netPaise);
      } else if (ledger.status === COMMISSION_STATUS.PENDING) {
        row.pendingNet += fromPaise(netPaise);
      }
      byVendor.set(key, row);
    }

    return {
      from: query.from,
      to: query.to,
      vendors: [...byVendor.values()],
    };
  }

  async adminReconciliation(query: ReportRangeQuery) {
    assertRange(query);
    const summary = await this.adminSummary(query);
    const expectedPaise = toPaise(summary.customerPayments);
    const accountedPaise =
      toPaise(summary.vendorNetPayouts) +
      toPaise(summary.commissionEarned) +
      toPaise(summary.taxCollected) +
      toPaise(summary.tcsCollected) +
      toPaise(summary.shippingCollected);
    const differencePaise = expectedPaise - accountedPaise;
    const balanced = differencePaise === 0;

    return {
      from: query.from,
      to: query.to,
      customerPayments: summary.customerPayments,
      vendorNetPayouts: summary.vendorNetPayouts,
      platformCommission: summary.commissionEarned,
      taxCollected: summary.taxCollected,
      tcsCollected: summary.tcsCollected,
      shippingCollected: summary.shippingCollected,
      accountedTotal: fromPaise(accountedPaise),
      difference: fromPaise(differencePaise),
      balanced,
      status: balanced ? 'BALANCED' : 'MISMATCH',
      error: balanced ? null : ERROR_MESSAGES.REPORT_RECONCILIATION_MISMATCH,
    };
  }

  async vendorSummary(vendorId: string, query: ReportRangeQuery, requesterVendorId?: string | null) {
    if (requesterVendorId && requesterVendorId !== vendorId) {
      throw new ForbiddenError(ERROR_MESSAGES.NOT_YOUR_VENDOR_REPORT);
    }
    assertRange(query);

    const ledgers = await CommissionLedger.findAll({
      where: {
        vendorId,
        createdAt: { [Op.between]: [query.from, query.to] },
      },
    });

    let salesPaise = 0;
    let commissionPaise = 0;
    let tcsPaise = 0;
    let netPaise = 0;
    let pendingPaise = 0;
    let settledPaise = 0;
    let vendorCouponDiscountPaise = 0;
    let platformCouponDiscountPaise = 0;

    for (const ledger of ledgers) {
      const taxable = frozenPaise(ledger.taxableAmountPaise, ledger.taxableAmount ?? ledger.saleAmount);
      const netRow = frozenPaise(
        ledger.netPayoutAmountPaise,
        ledger.netPayoutAmount != null
          ? ledger.netPayoutAmount
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount),
      );
      const commission = frozenPaise(ledger.commissionAmountPaise, ledger.commissionAmount);
      const tcs = frozenPaise(ledger.tcsAmountPaise, ledger.tcsAmount);
      const discount = frozenPaise(ledger.discountAmountPaise, ledger.discountAmount);

      salesPaise += taxable;
      commissionPaise += commission;
      tcsPaise += tcs;
      netPaise += netRow;
      if (ledger.status === COMMISSION_STATUS.PENDING) pendingPaise += netRow;
      if (ledger.status === COMMISSION_STATUS.SETTLED) settledPaise += netRow;

      // Own coupons: VENDOR bearer. Platform coupons on my items: PLATFORM bearer.
      if (discount > 0) {
        if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) {
          vendorCouponDiscountPaise += discount;
        } else {
          platformCouponDiscountPaise += discount;
        }
      }
    }

    return {
      from: query.from,
      to: query.to,
      vendorId,
      sales: fromPaise(salesPaise),
      commissionDeducted: fromPaise(commissionPaise),
      tcsDeducted: fromPaise(tcsPaise),
      discountAbsorbed: {
        ownCoupons: fromPaise(vendorCouponDiscountPaise),
        platformCouponsOnMyItems: fromPaise(platformCouponDiscountPaise),
      },
      netPayout: fromPaise(netPaise),
      upcomingPayout: fromPaise(pendingPaise),
      historicalPayout: fromPaise(settledPaise),
    };
  }

  /** Outstanding customer wallet balances platform-wide (latest ledger per user). */
  async walletLiabilityReport(_query: ReportRangeQuery): Promise<{
    totalLiability: number;
    customerCount: number;
    rows: Array<{ userId: string; balance: number; asOf: Date }>;
  }> {
    const ledgers = await WalletLedger.findAll({
      order: [
        ['userId', 'ASC'],
        ['createdAt', 'DESC'],
      ],
      attributes: ['userId', 'balanceAfter', 'createdAt', 'type', 'amount'],
    });

    const seen = new Set<string>();
    const rows: Array<{ userId: string; balance: number; asOf: Date }> = [];
    let totalLiability = 0;
    for (const row of ledgers) {
      if (seen.has(row.userId)) continue;
      seen.add(row.userId);
      const balance = Number(row.balanceAfter);
      if (balance <= 0) continue;
      totalLiability += balance;
      rows.push({ userId: row.userId, balance, asOf: row.createdAt as Date });
    }

    return {
      totalLiability: Math.round(totalLiability * 100) / 100,
      customerCount: rows.length,
      rows,
    };
  }

  /** Cashback write-offs: recovered vs written-off, filterable by bornBy. */
  async cashbackWriteOffReport(query: WriteOffReportQuery): Promise<{
    from: Date;
    to: Date;
    bornBy: string | null;
    recoveredTotal: number;
    writtenOffTotal: number;
    rows: Array<{
      id: string;
      userId: string;
      originalClawbackAmount: number;
      recoveredAmount: number;
      writtenOffAmount: number;
      bornBy: string;
      referenceType: string;
      referenceId: string;
      createdAt: Date;
    }>;
  }> {
    assertRange(query);
    const where: Record<string, unknown> = {
      createdAt: { [Op.between]: [query.from, query.to] },
    };
    if (query.bornBy) where.bornBy = query.bornBy;

    const writeOffs = await WalletWriteOff.findAll({ where, order: [['createdAt', 'DESC']] });
    let recoveredTotal = 0;
    let writtenOffTotal = 0;
    const rows = writeOffs.map((row) => {
      const recovered = Number(row.recoveredAmount);
      const writtenOff = Number(row.writtenOffAmount);
      recoveredTotal += recovered;
      writtenOffTotal += writtenOff;
      return {
        id: row.id,
        userId: row.userId,
        originalClawbackAmount: Number(row.originalClawbackAmount),
        recoveredAmount: recovered,
        writtenOffAmount: writtenOff,
        bornBy: row.bornBy,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdAt: row.createdAt as Date,
      };
    });

    return {
      from: query.from,
      to: query.to,
      bornBy: query.bornBy ?? null,
      recoveredTotal: Math.round(recoveredTotal * 100) / 100,
      writtenOffTotal: Math.round(writtenOffTotal * 100) / 100,
      rows,
    };
  }

  toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]!);
    const escape = (value: unknown) => {
      const raw = value == null ? '' : String(value);
      if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };
    return [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => escape(row[h])).join(',')),
    ].join('\n');
  }

  /** Build a real PDF buffer for settlement statement export. */
  async toPdf(title: string, rows: Record<string, unknown>[]): Promise<Buffer> {
    const PDFDocument = (await import('pdfkit')).default;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).text(title, { underline: true });
      doc.moveDown();

      if (rows.length === 0) {
        doc.fontSize(11).text('No rows');
        doc.end();
        return;
      }

      const headers = Object.keys(rows[0]!);
      doc.fontSize(9);
      for (const row of rows) {
        for (const header of headers) {
          const value = row[header];
          const display =
            value instanceof Date
              ? value.toISOString()
              : value == null
                ? ''
                : String(value);
          doc.text(`${header}: ${display}`);
        }
        doc.moveDown(0.5);
        if (doc.y > 750) doc.addPage();
      }
      doc.end();
    });
  }
}

export const reportsService = new ReportsService();
