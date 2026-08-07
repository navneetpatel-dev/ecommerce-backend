import { Op } from 'sequelize';
import { ForbiddenError } from '@core/errors/ForbiddenError';
import { ValidationError } from '@core/errors/ValidationError';
import { ERROR_MESSAGES } from '@core/constants/errors';
import { DISCOUNT_BEARER, PAYMENT_STATUS, COMMISSION_STATUS } from '@core/constants/statuses';
import { Order } from '@database/models/order.model';
import { SubOrder } from '@database/models/subOrder.model';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { Vendor } from '@database/models/vendor.model';
import { Coupon } from '@database/models/coupon.model';
import { toPaise, fromPaise } from '@modules/pricing/money';
import type { ReportRangeQuery } from './reports.dto';

function assertRange(query: ReportRangeQuery) {
  if (query.from > query.to) {
    throw new ValidationError(ERROR_MESSAGES.REPORT_INVALID_RANGE);
  }
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
    const ledgers = await CommissionLedger.findAll({
      where: {
        createdAt: { [Op.between]: [query.from, query.to] },
        status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
      },
    });

    let gmvPaise = 0;
    let taxCollectedPaise = 0;
    let shippingPaise = 0;
    let merchandiseDiscountPaise = 0;
    let customerPaymentsPaise = 0;

    for (const sub of subOrders) {
      const order = (sub as SubOrder & { order?: Order }).order;
      gmvPaise += toPaise(sub.subtotal);
      taxCollectedPaise += toPaise(sub.taxAmount);
      shippingPaise += toPaise(
        Math.max(0, Number(sub.shippingCost) - Number(sub.shippingDiscountAmount ?? 0)),
      );
      merchandiseDiscountPaise += toPaise(sub.discountAmount);
      if (order) {
        // Count order total once per order via Set below
      }
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
    customerPaymentsPaise = orders.reduce((sum, order) => sum + toPaise(order.totalAmount), 0);

    let commissionPaise = 0;
    let tcsPaise = 0;
    let netPayoutPaise = 0;
    let platformDiscountPaise = 0;
    let vendorDiscountPaise = 0;

    for (const ledger of ledgers) {
      commissionPaise += toPaise(ledger.commissionAmount);
      tcsPaise += toPaise(ledger.tcsAmount ?? 0);
      netPayoutPaise +=
        ledger.netPayoutAmount != null
          ? toPaise(ledger.netPayoutAmount)
          : toPaise(ledger.saleAmount) - toPaise(ledger.commissionAmount);
      const disc = toPaise(ledger.discountAmount ?? 0);
      if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) vendorDiscountPaise += disc;
      else if (ledger.discountBearer === DISCOUNT_BEARER.PLATFORM) platformDiscountPaise += disc;
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
      const taxable = Number(ledger.taxableAmount ?? ledger.saleAmount);
      const net =
        ledger.netPayoutAmount != null
          ? Number(ledger.netPayoutAmount)
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount);
      row.grossSales += taxable;
      if (ledger.discountBearer === DISCOUNT_BEARER.VENDOR) {
        row.discountsAbsorbed += Number(ledger.discountAmount ?? 0);
      }
      row.commissionCharged += Number(ledger.commissionAmount);
      row.tcsCharged += Number(ledger.tcsAmount ?? 0);
      if (ledger.status === COMMISSION_STATUS.SETTLED) {
        row.settledNet += net;
        row.netPaidOut += net;
      } else if (ledger.status === COMMISSION_STATUS.PENDING) {
        row.pendingNet += net;
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
      include: [
        {
          model: SubOrder,
          include: [
            {
              model: Order,
              as: 'order',
              attributes: ['id', 'couponId'],
              include: [{ model: Coupon, as: 'coupon', attributes: ['id', 'vendorId', 'discountBearer'] }],
            },
          ],
        },
      ],
    });

    let sales = 0;
    let commission = 0;
    let tcs = 0;
    let net = 0;
    let pending = 0;
    let settled = 0;
    let vendorCouponDiscount = 0;
    let platformCouponDiscount = 0;

    for (const ledger of ledgers) {
      const taxable = Number(ledger.taxableAmount ?? ledger.saleAmount);
      const netRow =
        ledger.netPayoutAmount != null
          ? Number(ledger.netPayoutAmount)
          : Number(ledger.saleAmount) - Number(ledger.commissionAmount);
      sales += taxable;
      commission += Number(ledger.commissionAmount);
      tcs += Number(ledger.tcsAmount ?? 0);
      net += netRow;
      if (ledger.status === COMMISSION_STATUS.PENDING) pending += netRow;
      if (ledger.status === COMMISSION_STATUS.SETTLED) settled += netRow;

      const discount = Number(ledger.discountAmount ?? 0);
      const sub = (ledger as any).SubOrder as
        | (SubOrder & { order?: Order & { coupon?: Coupon } })
        | undefined;
      const coupon = sub?.order?.coupon;
      if (discount > 0 && ledger.discountBearer === DISCOUNT_BEARER.VENDOR) {
        if (coupon?.vendorId && coupon.vendorId === vendorId) {
          vendorCouponDiscount += discount;
        } else {
          platformCouponDiscount += discount;
        }
      }
    }

    return {
      from: query.from,
      to: query.to,
      vendorId,
      sales,
      commissionDeducted: commission,
      tcsDeducted: tcs,
      discountAbsorbed: {
        ownCoupons: vendorCouponDiscount,
        platformCouponsOnMyItems: platformCouponDiscount,
      },
      netPayout: net,
      upcomingPayout: pending,
      historicalPayout: settled,
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

  /** Printable HTML statement — open and use browser “Save as PDF”. */
  toPrintableHtml(title: string, rows: Record<string, unknown>[]): string {
    const body =
      rows.length === 0
        ? '<p>No rows</p>'
        : `<table border="1" cellpadding="6" cellspacing="0"><thead><tr>${Object.keys(rows[0]!)
            .map((h) => `<th>${h}</th>`)
            .join('')}</tr></thead><tbody>${rows
            .map(
              (row) =>
                `<tr>${Object.keys(rows[0]!)
                  .map((h) => `<td>${row[h] ?? ''}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table>`;
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
  }
}

export const reportsService = new ReportsService();
