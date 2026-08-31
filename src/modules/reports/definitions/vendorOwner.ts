import { Op } from 'sequelize';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { ORDER_STATUS } from '@core/constants/statuses';
import { sequelize } from '@database/models';
import { CommissionLedger } from '@database/models/commissionLedger.model';
import { TcsLedger } from '@database/models/tcsLedger.model';
import { TdsLedger } from '@database/models/tdsLedger.model';
import { Payout } from '@database/models/payout.model';
import { SubOrder } from '@database/models/subOrder.model';
import { OrderItem } from '@database/models/orderItem.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { TaxRule } from '@database/models/taxRule.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  frozenPaise,
  fromPaise,
  dateBetween,
  paidOrderInclude,
  reportableOrderJoin,
  pagedFindAndCount,
  DISCOUNT_BEARER,
  COMMISSION_STATUS,
} from '../engine/queryHelpers';
import { keysetSqlQuery, type KeysetOrderCol } from '../engine/export/keysetSqlQuery';

function vendorScopeWhere(filters: ReportFilters): Record<string, unknown> {
  const vendorId = filters.scopedVendorId ?? filters.vendorId ?? null;
  return vendorId ? { vendorId } : {};
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100;
}

function periodKey(period: string | null | undefined, date: Date): string {
  if (period) return period;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** SQL expression matching frozenPaise(discountAmountPaise, discountAmount). */
const DISCOUNT_PAISE_SQL = `CASE
  WHEN COALESCE(cl."discountAmountPaise", 0) <> 0 THEN cl."discountAmountPaise"
  WHEN COALESCE(cl."discountAmount", 0) = 0 THEN 0
  ELSE ROUND(cl."discountAmount" * 100)
END`;

async function vendorSales(filters: ReportFilters) {
  assertReportRange(filters);

  const { rows, total } = await pagedFindAndCount(
    SubOrder,
    {
      where: vendorScopeWhere(filters),
      include: [paidOrderInclude(filters.from, filters.to)],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((sub) => ({
      subOrderId: sub.id,
      orderId: sub.orderId,
      status: sub.status,
      subtotal: fromPaise(frozenPaise(sub.subtotalPaise, sub.subtotal)),
      taxAmount: fromPaise(frozenPaise(sub.taxAmountPaise, sub.taxAmount)),
      discountAmount: fromPaise(frozenPaise(sub.discountAmountPaise, sub.discountAmount)),
      netPayout: fromPaise(frozenPaise(sub.netPayoutAmountPaise, sub.netPayoutAmount)),
      createdAt:
        (sub as SubOrder & { order?: { createdAt?: Date } }).order?.createdAt ?? sub.createdAt,
    })),
    total,
  };
}

async function vendorGstSales(filters: ReportFilters) {
  assertReportRange(filters);

  const { rows, total } = await pagedFindAndCount(
    OrderItem,
    {
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          required: true,
          where: vendorScopeWhere(filters),
          include: [paidOrderInclude(filters.from, filters.to)],
        },
        {
          model: ProductVariant,
          as: 'variant',
          required: true,
          include: [
            {
              model: Product,
              as: 'product',
              required: true,
              where: filters.categoryId ? { categoryId: filters.categoryId } : undefined,
              attributes: ['id', 'name', 'categoryId'],
            },
          ],
        },
      ],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  const categoryIds = [
    ...new Set(
      rows
        .map((item) => {
          const product = (
            item as OrderItem & { variant?: ProductVariant & { product?: Product } }
          ).variant?.product;
          return product?.categoryId ?? null;
        })
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const taxRules = categoryIds.length
    ? await TaxRule.findAll({
        where: { categoryId: { [Op.in]: categoryIds } },
        attributes: ['categoryId', 'hsnCode'],
      })
    : [];

  const hsnByCategory = new Map<string, string>();
  for (const rule of taxRules) {
    if (rule.categoryId && rule.hsnCode && !hsnByCategory.has(rule.categoryId)) {
      hsnByCategory.set(rule.categoryId, rule.hsnCode);
    }
  }

  return {
    rows: rows.map((item) => {
      const sub = (item as OrderItem & { subOrder?: SubOrder }).subOrder;
      const product = (
        item as OrderItem & { variant?: ProductVariant & { product?: Product } }
      ).variant?.product;
      const categoryId = product?.categoryId ?? '';
      const tb = (item.taxBreakdown ?? {}) as Record<string, unknown>;
      return {
        orderId: sub?.orderId ?? null,
        subOrderId: item.subOrderId,
        invoiceId: (sub as { taxInvoiceNumber?: string | null } | undefined)
          ?.taxInvoiceNumber ?? null,
        productName: item.productName,
        hsnCode: hsnByCategory.get(categoryId) ?? 'UNKNOWN',
        qty: Number(item.quantity ?? 0),
        taxable: fromPaise(frozenPaise(item.taxableAmountPaise, item.taxableAmount)),
        cgst: Number(tb.cgst ?? 0),
        sgst: Number(tb.sgst ?? 0),
        igst: Number(tb.igst ?? 0),
        tax: fromPaise(frozenPaise(item.taxAmountPaise, item.taxAmount)),
      };
    }),
    total,
  };
}

async function vendorTcsCredit(filters: ReportFilters) {
  assertReportRange(filters);

  const { rows, total } = await pagedFindAndCount(
    TcsLedger,
    {
      where: {
        ...vendorScopeWhere(filters),
        createdAt: dateBetween(filters.from, filters.to),
      },
      include: [reportableOrderJoin()],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((row) => ({
      orderId: row.orderId,
      subOrderId: row.subOrderId,
      period: periodKey(row.period, row.createdAt as Date),
      section: String(row.section ?? '52'),
      entryType: String(row.entryType ?? 'COLLECTION'),
      vendorGstin: row.vendorGstin ?? null,
      placeOfSupplyState: row.placeOfSupplyState ?? null,
      taxableValue: fromPaise(Number(row.taxableAmountPaise ?? 0)),
      tcsCgst: fromPaise(Number(row.tcsCgstPaise ?? 0)),
      tcsSgst: fromPaise(Number(row.tcsSgstPaise ?? 0)),
      tcsIgst: fromPaise(Number(row.tcsIgstPaise ?? 0)),
      tcsTotal: fromPaise(Number(row.tcsAmountPaise ?? 0)),
      createdAt: row.createdAt,
    })),
    total,
  };
}

async function vendorTdsCertificate(filters: ReportFilters) {
  assertReportRange(filters);

  const { rows, total } = await pagedFindAndCount(
    TdsLedger,
    {
      where: {
        ...vendorScopeWhere(filters),
        createdAt: dateBetween(filters.from, filters.to),
      },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((row) => ({
      orderId: row.orderId,
      subOrderId: row.subOrderId,
      payoutId: row.payoutId,
      period: periodKey(row.period, row.createdAt as Date),
      section: row.section || '194O',
      grossTaxable: fromPaise(Number(row.taxableAmountPaise ?? 0)),
      tdsAmount: fromPaise(Number(row.tdsAmountPaise ?? 0)),
      createdAt: row.createdAt,
    })),
    total,
  };
}

async function vendorPayoutStatement(filters: ReportFilters) {
  assertReportRange(filters);

  const where: Record<string, unknown> = {
    ...vendorScopeWhere(filters),
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    Payout,
    {
      where,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((p) => ({
      payoutId: p.id,
      amount: Number(p.amount ?? 0),
      status: p.status,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      paidAt: p.paidAt,
      razorpayPayoutId: p.razorpayPayoutId,
      createdAt: p.createdAt,
    })),
    total,
  };
}

const VENDOR_PAYOUT_KEYSET: KeysetOrderCol[] = [
  { column: 'createdAt', direction: 'DESC' },
  { column: 'payoutId', direction: 'DESC' },
];

function mapVendorPayoutRow(row: Record<string, unknown>) {
  return {
    payoutId: String(row.payoutId ?? ''),
    amount: Number(row.amount ?? 0),
    status: String(row.status ?? ''),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  };
}

function vendorPayoutSelectSql(): string {
  return `
    SELECT
      p.id AS "payoutId",
      p.amount AS amount,
      p.status AS status,
      p."periodStart" AS "periodStart",
      p."periodEnd" AS "periodEnd",
      p."paidAt" AS "paidAt",
      p."createdAt" AS "createdAt"
    FROM payouts p
    WHERE p."deletedAt" IS NULL
      AND p."createdAt" BETWEEN :from AND :to
      AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId)
      AND (:status::text IS NULL OR p.status::text = :status)
  `;
}

async function vendorPayoutStatementExport(
  filters: ReportFilters,
  cursor: { values: unknown[] } | null,
  limit: number,
) {
  assertReportRange(filters);
  const vendorId = filters.scopedVendorId ?? filters.vendorId ?? null;
  const page = await keysetSqlQuery({
    selectSql: vendorPayoutSelectSql(),
    order: VENDOR_PAYOUT_KEYSET,
    replacements: {
      from: filters.from,
      to: filters.to,
      vendorId,
      status: filters.status ?? null,
    },
    limit,
    cursor,
    mapRow: (row) => mapVendorPayoutRow(row),
  });
  return { rows: page.rows, nextCursor: page.nextCursor };
}

async function vendorCommissionDeducted(filters: ReportFilters) {
  assertReportRange(filters);

  const { rows, total } = await pagedFindAndCount(
    CommissionLedger,
    {
      where: {
        ...vendorScopeWhere(filters),
        createdAt: dateBetween(filters.from, filters.to),
        status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
      },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((ledger) => ({
      subOrderId: ledger.subOrderId,
      status: ledger.status,
      saleAmount: fromPaise(frozenPaise(ledger.saleAmountPaise, ledger.saleAmount)),
      commissionRate: Number(ledger.commissionRate ?? 0),
      commissionAmount: fromPaise(
        frozenPaise(ledger.commissionAmountPaise, ledger.commissionAmount),
      ),
      tcsAmount: fromPaise(frozenPaise(ledger.tcsAmountPaise, ledger.tcsAmount)),
      netPayout: fromPaise(
        frozenPaise(
          ledger.netPayoutAmountPaise,
          ledger.netPayoutAmount != null
            ? ledger.netPayoutAmount
            : Number(ledger.saleAmount) - Number(ledger.commissionAmount),
        ),
      ),
      createdAt: ledger.createdAt,
    })),
    total,
  };
}

async function vendorDiscountCost(filters: ReportFilters) {
  assertReportRange(filters);

  const scope = vendorScopeWhere(filters);
  const vendorId = (scope.vendorId as string | undefined) ?? null;

  const where: Record<string, unknown> = {
    ...scope,
    createdAt: dateBetween(filters.from, filters.to),
    status: { [Op.ne]: COMMISSION_STATUS.CLAWED_BACK },
    [Op.or]: [
      { discountAmountPaise: { [Op.gt]: 0 } },
      { discountAmountPaise: 0, discountAmount: { [Op.gt]: 0 } },
    ],
  };

  const vendorClause = vendorId ? 'AND cl."vendorId" = :vendorId' : '';
  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
    clawedBack: COMMISSION_STATUS.CLAWED_BACK,
    vendorBearer: DISCOUNT_BEARER.VENDOR,
  };
  if (vendorId) replacements.vendorId = vendorId;

  const [{ rows, total }, [metaRows]] = await Promise.all([
    pagedFindAndCount(
      CommissionLedger,
      {
        where,
        order: [['createdAt', 'DESC']],
      },
      filters,
    ),
    sequelize.query(
      `
      SELECT
        COALESCE(SUM(CASE
          WHEN cl."discountBearer" = :vendorBearer THEN (${DISCOUNT_PAISE_SQL})
          ELSE 0
        END), 0)::bigint AS "ownCouponsPaise",
        COALESCE(SUM(CASE
          WHEN cl."discountBearer" IS DISTINCT FROM :vendorBearer THEN (${DISCOUNT_PAISE_SQL})
          ELSE 0
        END), 0)::bigint AS "platformCouponsPaise"
      FROM commission_ledgers cl
      WHERE cl."deletedAt" IS NULL
        AND cl."createdAt" BETWEEN :from AND :to
        AND cl.status <> :clawedBack
        AND (${DISCOUNT_PAISE_SQL}) > 0
        ${vendorClause}
      `,
      { replacements },
    ),
  ]);

  const metaRow = (metaRows as Array<{ ownCouponsPaise: string | number; platformCouponsPaise: string | number }>)[0];

  return {
    rows: rows.map((ledger) => {
      const disc = frozenPaise(ledger.discountAmountPaise, ledger.discountAmount);
      const bearer =
        ledger.discountBearer === DISCOUNT_BEARER.VENDOR
          ? DISCOUNT_BEARER.VENDOR
          : DISCOUNT_BEARER.PLATFORM;
      return {
        subOrderId: ledger.subOrderId,
        discountBearer: bearer,
        discountAmount: fromPaise(disc),
        createdAt: ledger.createdAt,
      };
    }),
    total,
    meta: {
      ownCoupons: fromPaise(Number(metaRow?.ownCouponsPaise ?? 0)),
      platformCouponsOnMyItems: fromPaise(Number(metaRow?.platformCouponsPaise ?? 0)),
    },
  };
}

async function vendorReturnRefund(filters: ReportFilters) {
  assertReportRange(filters);

  const where: Record<string, unknown> = {
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    ReturnRequest,
    {
      where,
      include: [
        {
          model: SubOrder,
          as: 'subOrder',
          required: true,
          where: vendorScopeWhere(filters),
          attributes: ['id', 'vendorId', 'orderId'],
        },
      ],
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((r) => {
      const created = r.createdAt as Date;
      const resolved = r.resolvedAt;
      return {
        id: r.id,
        orderId: (r as ReturnRequest & { subOrder?: SubOrder }).subOrder?.orderId ?? null,
        subOrderId: r.subOrderId,
        orderItemId: r.orderItemId,
        reasonCode: r.reasonCode,
        status: r.status,
        refundAmount: Number(r.refundAmount ?? 0),
        turnaroundHours: resolved ? hoursBetween(created, resolved as Date) : null,
        createdAt: created,
        resolvedAt: resolved,
      };
    }),
    total,
  };
}

async function vendorInventory(filters: ReportFilters) {
  assertReportRange(filters);

  const productWhere: Record<string, unknown> = { ...vendorScopeWhere(filters) };
  if (filters.categoryId) productWhere.categoryId = filters.categoryId;
  if (filters.status) productWhere.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    ProductVariant,
    {
      include: [
        {
          model: Product,
          as: 'product',
          required: true,
          where: productWhere,
          attributes: ['id', 'name', 'categoryId', 'status', 'vendorId'],
        },
      ],
      order: [['sku', 'ASC']],
    },
    filters,
  );

  return {
    rows: rows.map((v) => {
      const product = (v as ProductVariant & { product?: Product }).product;
      const stock = Number(v.stock ?? 0);
      const price = Number(v.price ?? 0);
      const lowStockAt = Number(v.lowStockAt ?? 0);
      return {
        variantId: v.id,
        sku: v.sku,
        productId: product?.id ?? v.productId,
        productName: product?.name ?? '',
        categoryId: product?.categoryId ?? null,
        stock,
        lowStockAt,
        isLowStock: stock <= lowStockAt,
        price,
        valuation: Math.round(stock * price * 100) / 100,
      };
    }),
    total,
  };
}

async function vendorFulfillmentSla(filters: ReportFilters) {
  assertReportRange(filters);

  const where: Record<string, unknown> = {
    ...vendorScopeWhere(filters),
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    SubOrder,
    {
      where,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((sub) => {
      const delivered =
        sub.status === ORDER_STATUS.DELIVERED
          ? hoursBetween(sub.createdAt as Date, sub.updatedAt as Date)
          : null;
      return {
        subOrderId: sub.id,
        orderId: sub.orderId,
        status: sub.status,
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt,
        hoursToDeliver: delivered,
      };
    }),
    total,
  };
}

export const vendorOwnerReports: ReportDefinition[] = [
  {
    type: 'vendor-sales',
    labelKey: 'reportVendorSales',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'status', labelKey: 'status' },
      { key: 'subtotal', labelKey: 'subtotal', format: 'currency' },
      { key: 'taxAmount', labelKey: 'taxAmount', format: 'currency' },
      { key: 'discountAmount', labelKey: 'discountAmount', format: 'currency' },
      { key: 'netPayout', labelKey: 'netPayout', format: 'currency' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: vendorSales,
  },
  {
    type: 'vendor-gst-sales',
    labelKey: 'reportVendorGstSales',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'invoiceId', labelKey: 'invoiceId' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'hsnCode', labelKey: 'hsnCode' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'cgst', labelKey: 'cgst', format: 'currency' },
      { key: 'sgst', labelKey: 'sgst', format: 'currency' },
      { key: 'igst', labelKey: 'igst', format: 'currency' },
      { key: 'tax', labelKey: 'tax', format: 'currency' },
    ],
    query: vendorGstSales,
  },
  {
    type: 'vendor-tcs-credit',
    labelKey: 'reportVendorTcsCredit',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'period', labelKey: 'period' },
      { key: 'section', labelKey: 'section' },
      { key: 'entryType', labelKey: 'entryType' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
      { key: 'taxableValue', labelKey: 'taxableValue', format: 'currency' },
      { key: 'tcsCgst', labelKey: 'tcsCgst', format: 'currency' },
      { key: 'tcsSgst', labelKey: 'tcsSgst', format: 'currency' },
      { key: 'tcsIgst', labelKey: 'tcsIgst', format: 'currency' },
      { key: 'tcsTotal', labelKey: 'tcsTotal', format: 'currency' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: vendorTcsCredit,
  },
  {
    type: 'vendor-tds-certificate',
    labelKey: 'reportVendorTdsCertificate',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'payoutId', labelKey: 'payoutId' },
      { key: 'period', labelKey: 'period' },
      { key: 'section', labelKey: 'section' },
      { key: 'grossTaxable', labelKey: 'grossTaxable', format: 'currency' },
      { key: 'tdsAmount', labelKey: 'tdsAmount', format: 'currency' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: vendorTdsCertificate,
  },
  {
    type: 'vendor-payout-statement',
    labelKey: 'reportVendorPayoutStatement',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'payoutId', labelKey: 'payoutId' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
      { key: 'status', labelKey: 'status' },
      { key: 'periodStart', labelKey: 'periodStart', format: 'date' },
      { key: 'periodEnd', labelKey: 'periodEnd', format: 'date' },
      { key: 'paidAt', labelKey: 'paidAt', format: 'date' },
    ],
    query: vendorPayoutStatement,
    exportQuery: vendorPayoutStatementExport,
  },
  {
    type: 'vendor-commission-deducted',
    labelKey: 'reportVendorCommissionDeducted',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'status', labelKey: 'status' },
      { key: 'saleAmount', labelKey: 'saleAmount', format: 'currency' },
      { key: 'commissionRate', labelKey: 'commissionRate', format: 'number' },
      { key: 'commissionAmount', labelKey: 'commissionAmount', format: 'currency' },
      { key: 'tcsAmount', labelKey: 'tcsAmount', format: 'currency' },
      { key: 'netPayout', labelKey: 'netPayout', format: 'currency' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: vendorCommissionDeducted,
  },
  {
    type: 'vendor-discount-cost',
    labelKey: 'reportVendorDiscountCost',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'discountBearer', labelKey: 'discountBearer' },
      { key: 'discountAmount', labelKey: 'discountAmount', format: 'currency' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
    ],
    query: vendorDiscountCost,
  },
  {
    type: 'vendor-return-refund',
    labelKey: 'reportVendorReturnRefund',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: [
      { key: 'id', labelKey: 'id' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'reasonCode', labelKey: 'reasonCode' },
      { key: 'status', labelKey: 'status' },
      { key: 'refundAmount', labelKey: 'refundAmount', format: 'currency' },
      { key: 'turnaroundHours', labelKey: 'turnaroundHours', format: 'number' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'resolvedAt', labelKey: 'resolvedAt', format: 'date' },
    ],
    query: vendorReturnRefund,
  },
  {
    type: 'vendor-inventory',
    labelKey: 'reportVendorInventory',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: false,
    columns: [
      { key: 'sku', labelKey: 'sku' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'stock', labelKey: 'stock', format: 'number' },
      { key: 'lowStockAt', labelKey: 'lowStockAt', format: 'number' },
      { key: 'isLowStock', labelKey: 'isLowStock' },
      { key: 'price', labelKey: 'price', format: 'currency' },
      { key: 'valuation', labelKey: 'valuation', format: 'currency' },
    ],
    query: vendorInventory,
  },
  {
    type: 'vendor-fulfillment-sla',
    labelKey: 'reportVendorFulfillmentSla',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: false,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'status', labelKey: 'status' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'updatedAt', labelKey: 'updatedAt', format: 'date' },
      { key: 'hoursToDeliver', labelKey: 'hoursToDeliver', format: 'number' },
    ],
    query: vendorFulfillmentSla,
  },
];
