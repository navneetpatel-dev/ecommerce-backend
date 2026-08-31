import { PAYMENT_METHOD, PAYMENT_STATUS, ORDER_STATUS } from '@core/constants/statuses';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { sequelize } from '@database/models';
import { WalletLedger } from '@database/models/walletLedger.model';
import { SupportTicket } from '@database/models/supportTicket.model';
import { Vendor } from '@database/models/vendor.model';
import { ProductVariant } from '@database/models/productVariant.model';
import { Product } from '@database/models/product.model';
import { NewsletterSubscriber } from '@database/models/newsletterSubscriber.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import {
  assertReportRange,
  fromPaise,
  pagedFindAndCount,
  pagedSqlQuery,
  emptyPage,
  dateBetween,
  sqlFrozenPaise,
  REPORTABLE_ORDER_SQL,
} from '../engine/queryHelpers';

function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

function sqlReplacements(filters: ReportFilters): Record<string, unknown> {
  return {
    from: filters.from,
    to: filters.to,
    vendorId: resolveVendorId(filters),
  };
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100;
}

async function taxInvoiceRegister(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      so.id AS "subOrderId",
      so."orderId" AS "orderId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      COALESCE(v."gstNumber", '') AS "vendorGstin",
      so."taxInvoiceNumber" AS "taxInvoiceNumber",
      so."taxInvoiceIssuedAt" AS "taxInvoiceIssuedAt",
      COALESCE(so."taxableAmount", 0)::float AS taxable,
      COALESCE(so."taxAmount", 0)::float AS tax,
      COALESCE(so."customerTotal", 0)::float AS total,
      o."paymentMethod"::text AS "paymentMethod",
      o."paymentStatus"::text AS "paymentStatus",
      COALESCE(NULLIF(TRIM(a.gstin), ''), '') AS "buyerGstin",
      COALESCE(a.state, '') AS "placeOfSupplyState"
    FROM sub_orders so
    INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
    INNER JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    LEFT JOIN addresses a ON a.id = o."shippingAddressId"
    WHERE so."deletedAt" IS NULL
      AND so."taxInvoiceNumber" IS NOT NULL
      AND so."taxInvoiceIssuedAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"taxInvoiceIssuedAt" DESC, "taxInvoiceNumber" ASC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      subOrderId: row.subOrderId,
      orderId: row.orderId,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      vendorGstin: row.vendorGstin,
      taxInvoiceNumber: row.taxInvoiceNumber,
      taxInvoiceIssuedAt: row.taxInvoiceIssuedAt,
      taxable: Number(row.taxable ?? 0),
      tax: Number(row.tax ?? 0),
      total: Number(row.total ?? 0),
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      buyerGstin: row.buyerGstin,
      placeOfSupplyState: row.placeOfSupplyState,
    }),
  });
}

async function b2bGstinSalesRegister(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      so."taxInvoiceNumber" AS "taxInvoiceNumber",
      so."taxInvoiceIssuedAt" AS "taxInvoiceIssuedAt",
      so."orderId" AS "orderId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      COALESCE(v."gstNumber", '') AS "vendorGstin",
      COALESCE(NULLIF(TRIM(a.gstin), ''), '') AS "buyerGstin",
      u.name AS "buyerName",
      COALESCE(a.state, '') AS "placeOfSupplyState",
      COALESCE(so."taxableAmount", 0)::float AS taxable,
      COALESCE(so."taxAmount", 0)::float AS tax,
      COALESCE(so."customerTotal", 0)::float AS total
    FROM sub_orders so
    INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
    INNER JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    INNER JOIN addresses a ON a.id = o."shippingAddressId"
      AND NULLIF(TRIM(a.gstin), '') IS NOT NULL
    LEFT JOIN users u ON u.id = o."userId"
    WHERE so."deletedAt" IS NULL
      AND so."taxInvoiceNumber" IS NOT NULL
      AND so."taxInvoiceIssuedAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"taxInvoiceIssuedAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      taxInvoiceNumber: row.taxInvoiceNumber,
      taxInvoiceIssuedAt: row.taxInvoiceIssuedAt,
      orderId: row.orderId,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      vendorGstin: row.vendorGstin,
      buyerGstin: row.buyerGstin,
      buyerName: row.buyerName ?? '',
      placeOfSupplyState: row.placeOfSupplyState,
      taxable: Number(row.taxable ?? 0),
      tax: Number(row.tax ?? 0),
      total: Number(row.total ?? 0),
    }),
  });
}

async function gstr1Filing(filters: ReportFilters) {
  assertReportRange(filters);
  const taxExpr = sqlFrozenPaise('so', 'taxAmountPaise', 'taxAmount');
  const taxableExpr = sqlFrozenPaise('so', 'taxableAmountPaise', 'taxableAmount');
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;

  const selectSql = `
    SELECT * FROM (
      SELECT
        'B2B'::text AS section,
        so."taxInvoiceNumber" AS "documentNumber",
        so."taxInvoiceIssuedAt" AS "documentDate",
        COALESCE(NULLIF(TRIM(a.gstin), ''), '') AS "recipientGstin",
        COALESCE(a.state, '') AS state,
        ''::text AS "hsnCode",
        0::int AS qty,
        SUM(${taxableExpr})::bigint AS "taxablePaise",
        SUM(${taxExpr})::bigint AS "taxPaise",
        0::bigint AS "igstPaise",
        0::bigint AS "cgstPaise",
        0::bigint AS "sgstPaise"
      FROM sub_orders so
      INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
      INNER JOIN addresses a ON a.id = o."shippingAddressId"
        AND NULLIF(TRIM(a.gstin), '') IS NOT NULL
      WHERE so."deletedAt" IS NULL
        AND so."taxInvoiceNumber" IS NOT NULL
        AND so."taxInvoiceIssuedAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        ${vendorFilter}
      GROUP BY so."taxInvoiceNumber", so."taxInvoiceIssuedAt", a.gstin, a.state

      UNION ALL

      SELECT
        'B2C'::text AS section,
        'AGGREGATE'::text AS "documentNumber",
        MAX(so."taxInvoiceIssuedAt") AS "documentDate",
        ''::text AS "recipientGstin",
        COALESCE(a.state, '') AS state,
        ''::text AS "hsnCode",
        0::int AS qty,
        SUM(${taxableExpr})::bigint AS "taxablePaise",
        SUM(${taxExpr})::bigint AS "taxPaise",
        0::bigint AS "igstPaise",
        0::bigint AS "cgstPaise",
        0::bigint AS "sgstPaise"
      FROM sub_orders so
      INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
      INNER JOIN addresses a ON a.id = o."shippingAddressId"
        AND NULLIF(TRIM(a.gstin), '') IS NULL
      WHERE so."deletedAt" IS NULL
        AND so."taxInvoiceNumber" IS NOT NULL
        AND so."taxInvoiceIssuedAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        ${vendorFilter}
      GROUP BY a.state

      UNION ALL

      SELECT
        'CDN'::text AS section,
        cn.number AS "documentNumber",
        cn."issuedAt" AS "documentDate",
        ''::text AS "recipientGstin",
        ''::text AS state,
        ''::text AS "hsnCode",
        0::int AS qty,
        cn."merchandisePaise"::bigint AS "taxablePaise",
        cn."taxPaise"::bigint AS "taxPaise",
        0::bigint AS "igstPaise",
        0::bigint AS "cgstPaise",
        0::bigint AS "sgstPaise"
      FROM credit_notes cn
      WHERE cn."deletedAt" IS NULL
        AND cn."issuedAt" BETWEEN :from AND :to
        AND (:vendorId::uuid IS NULL OR cn."vendorId" = :vendorId)
    ) AS gstr1_rows
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `section ASC, "documentDate" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      section: row.section,
      documentNumber: row.documentNumber,
      documentDate: row.documentDate,
      recipientGstin: row.recipientGstin,
      state: row.state,
      hsnCode: row.hsnCode,
      qty: Number(row.qty ?? 0),
      taxable: fromPaise(Number(row.taxablePaise ?? 0)),
      tax: fromPaise(Number(row.taxPaise ?? 0)),
    }),
  });
}

async function gstr3bSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const taxableExpr = sqlFrozenPaise('so', 'taxableAmountPaise', 'taxableAmount');
  const taxExpr = sqlFrozenPaise('so', 'taxAmountPaise', 'taxAmount');
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;

  const [rows] = await sequelize.query(
    `
    WITH scoped AS (
      SELECT so.*
      FROM sub_orders so
      INNER JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
      WHERE so."deletedAt" IS NULL
        AND so."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        ${vendorFilter}
    ),
    tax_parts AS (
      SELECT
        COALESCE(SUM(${taxableExpr.replace(/\bso\./g, 'scoped.')}), 0)::bigint AS "taxablePaise",
        COALESCE(SUM(${taxExpr.replace(/\bso\./g, 'scoped.')}), 0)::bigint AS "taxPaise"
      FROM scoped
    ),
    tcs_parts AS (
      SELECT COALESCE(SUM(t."tcsAmountPaise"), 0)::bigint AS "tcsPaise"
      FROM tcs_ledgers t
      INNER JOIN orders o ON o.id = t."orderId" AND o."deletedAt" IS NULL
      WHERE t."deletedAt" IS NULL
        AND t."createdAt" BETWEEN :from AND :to
        AND ${REPORTABLE_ORDER_SQL}
        AND (:vendorId::uuid IS NULL OR t."vendorId" = :vendorId)
    )
    SELECT 'OUTWARD_TAXABLE'::text AS line, tp."taxablePaise" AS "amountPaise" FROM tax_parts tp
    UNION ALL SELECT 'OUTWARD_TAX'::text, tp."taxPaise" FROM tax_parts tp
    UNION ALL SELECT 'TCS_COLLECTED'::text, tc."tcsPaise" FROM tcs_parts tc
    UNION ALL SELECT 'NET_TAX_LIABILITY'::text, (tp."taxPaise" + tc."tcsPaise")::bigint
    FROM tax_parts tp CROSS JOIN tcs_parts tc
    `,
    { replacements: sqlReplacements(filters) },
  );

  const mapped = (rows as Array<Record<string, unknown>>).map((row) => ({
    line: String(row.line ?? ''),
    amount: fromPaise(Number(row.amountPaise ?? 0)),
  }));

  return { rows: mapped, total: mapped.length, meta: { period: filters.from.toISOString().slice(0, 7) } };
}

async function paymentGatewayReconciliation(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      o.id AS "orderId",
      o."createdAt" AS "createdAt",
      o."paymentMethod"::text AS "paymentMethod",
      o."paymentStatus"::text AS "paymentStatus",
      COALESCE(o."razorpayOrderId", '') AS "razorpayOrderId",
      COALESCE(o."razorpayPaymentId", '') AS "razorpayPaymentId",
      COALESCE(o."razorpayAmountPaid", 0)::float AS "razorpayAmount",
      COALESCE(o."totalAmount", 0)::float AS "orderTotal",
      COALESCE(o."walletAmountUsed", 0)::float AS "walletUsed",
      CASE
        WHEN o."paymentMethod" <> '${PAYMENT_METHOD.RAZORPAY}' THEN 'NOT_APPLICABLE'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}' AND o."razorpayPaymentId" IS NOT NULL THEN 'MATCHED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PAID}' AND o."razorpayPaymentId" IS NULL THEN 'MISSING_PG_REF'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.PENDING}' THEN 'PENDING'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.FAILED}' THEN 'FAILED'
        WHEN o."paymentStatus" = '${PAYMENT_STATUS.REFUNDED}' THEN 'REFUNDED'
        ELSE 'REVIEW'
      END AS "reconStatus"
    FROM orders o
    WHERE o."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND o."paymentMethod" = '${PAYMENT_METHOD.RAZORPAY}'
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      orderId: row.orderId,
      createdAt: row.createdAt,
      paymentMethod: row.paymentMethod,
      paymentStatus: row.paymentStatus,
      razorpayOrderId: row.razorpayOrderId,
      razorpayPaymentId: row.razorpayPaymentId,
      razorpayAmount: Number(row.razorpayAmount ?? 0),
      orderTotal: Number(row.orderTotal ?? 0),
      walletUsed: Number(row.walletUsed ?? 0),
      reconStatus: row.reconStatus,
    }),
  });
}

async function codRemittance(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      o.id AS "orderId",
      o."createdAt" AS "createdAt",
      o.status::text AS "orderStatus",
      o."paymentStatus"::text AS "paymentStatus",
      COALESCE(o."amountDue", o."totalAmount", 0)::float AS "codAmount",
      COALESCE(o."walletAmountUsed", 0)::float AS "walletUsed",
      CASE
        WHEN o.status = '${ORDER_STATUS.CANCELLED}' THEN 'CANCELLED'
        WHEN o.status = '${ORDER_STATUS.DELIVERED}' AND o."paymentStatus" = '${PAYMENT_STATUS.PAID}' THEN 'COLLECTED'
        WHEN o.status = '${ORDER_STATUS.DELIVERED}' THEN 'DELIVERED_UNPAID'
        ELSE 'OPEN'
      END AS "codStatus"
    FROM orders o
    WHERE o."deletedAt" IS NULL
      AND o."paymentMethod" = '${PAYMENT_METHOD.COD}'
      AND o."createdAt" BETWEEN :from AND :to
      AND o.status <> '${ORDER_STATUS.CANCELLED}'
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      orderId: row.orderId,
      createdAt: row.createdAt,
      orderStatus: row.orderStatus,
      paymentStatus: row.paymentStatus,
      codAmount: Number(row.codAmount ?? 0),
      walletUsed: Number(row.walletUsed ?? 0),
      codStatus: row.codStatus,
    }),
  });
}

async function shippingLogistics(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR so."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      so.id AS "subOrderId",
      so."orderId" AS "orderId",
      so."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      COALESCE(so."shippingCost", 0)::float AS "shippingCost",
      COALESCE(so."shippingCharged", 0)::float AS "shippingCharged",
      COALESCE(sh.carrier, '') AS carrier,
      COALESCE(sh.status::text, 'NONE') AS "shipmentStatus",
      sh."shippedAt" AS "shippedAt",
      sh."deliveredAt" AS "deliveredAt",
      so."createdAt" AS "createdAt"
    FROM sub_orders so
    LEFT JOIN shipments sh ON sh."subOrderId" = so.id AND sh."deletedAt" IS NULL
    LEFT JOIN vendors v ON v.id = so."vendorId" AND v."deletedAt" IS NULL
    WHERE so."deletedAt" IS NULL
      AND so."createdAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      subOrderId: row.subOrderId,
      orderId: row.orderId,
      vendorId: row.vendorId,
      vendorName: row.vendorName ?? '',
      shippingCost: Number(row.shippingCost ?? 0),
      shippingCharged: Number(row.shippingCharged ?? 0),
      carrier: row.carrier,
      shipmentStatus: row.shipmentStatus,
      shippedAt: row.shippedAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
    }),
  });
}

async function abandonedCartReport(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      c.id AS "cartId",
      c."userId" AS "userId",
      u.email AS "userEmail",
      u.name AS "userName",
      c."updatedAt" AS "lastActivityAt",
      COUNT(ci.id)::int AS "itemCount",
      COALESCE(SUM(ci.quantity * pv.price), 0)::float AS "cartValue"
    FROM carts c
    INNER JOIN cart_items ci ON ci."cartId" = c.id AND ci."deletedAt" IS NULL
    INNER JOIN product_variants pv ON pv.id = ci."variantId" AND pv."deletedAt" IS NULL
    LEFT JOIN users u ON u.id = c."userId"
    WHERE c."deletedAt" IS NULL
      AND c."userId" IS NOT NULL
      AND c."updatedAt" BETWEEN :from AND :to
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o."userId" = c."userId"
          AND o."deletedAt" IS NULL
          AND o."createdAt" >= c."updatedAt"
      )
    GROUP BY c.id, c."userId", u.email, u.name, c."updatedAt"
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"lastActivityAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      cartId: row.cartId,
      userId: row.userId,
      userEmail: row.userEmail ?? '',
      userName: row.userName ?? '',
      lastActivityAt: row.lastActivityAt,
      itemCount: Number(row.itemCount ?? 0),
      cartValue: Number(row.cartValue ?? 0),
    }),
  });
}

async function platformInventory(filters: ReportFilters) {
  assertReportRange(filters);
  const productWhere: Record<string, unknown> = {};
  if (filters.vendorId) productWhere.vendorId = filters.vendorId;
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
          include: [
            {
              model: Vendor,
              as: 'vendor',
              attributes: ['id', 'businessName'],
              required: false,
            },
          ],
        },
      ],
      order: [['sku', 'ASC']],
    },
    filters,
  );

  return {
    rows: rows.map((v) => {
      const product = (v as ProductVariant & {
        product?: Product & { vendor?: Vendor };
      }).product;
      const stock = Number(v.stock ?? 0);
      const price = Number(v.price ?? 0);
      const lowStockAt = Number(v.lowStockAt ?? 0);
      return {
        variantId: v.id,
        sku: v.sku,
        productId: product?.id ?? v.productId,
        productName: product?.name ?? '',
        vendorId: product?.vendorId ?? null,
        vendorName: product?.vendor?.businessName ?? '',
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

async function customerAnalytics(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      u.id AS "userId",
      COALESCE(u.email, '') AS email,
      COALESCE(u.name, '') AS name,
      COUNT(o.id)::int AS "orderCount",
      COALESCE(SUM(o."totalAmount"), 0)::float AS "totalSpent",
      MIN(o."createdAt") AS "firstOrderAt",
      MAX(o."createdAt") AS "lastOrderAt",
      CASE WHEN COUNT(o.id) <= 1 THEN 'NEW' ELSE 'RETURNING' END AS segment
    FROM users u
    INNER JOIN orders o ON o."userId" = u.id AND o."deletedAt" IS NULL
    WHERE o."createdAt" BETWEEN :from AND :to
    GROUP BY u.id, u.email, u.name
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"totalSpent" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      orderCount: Number(row.orderCount ?? 0),
      totalSpent: Number(row.totalSpent ?? 0),
      firstOrderAt: row.firstOrderAt,
      lastOrderAt: row.lastOrderAt,
      segment: row.segment,
    }),
  });
}

async function supportTicketSla(filters: ReportFilters) {
  assertReportRange(filters);
  const where: Record<string, unknown> = {
    createdAt: dateBetween(filters.from, filters.to),
  };
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    SupportTicket,
    {
      where,
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((t) => {
      const created = t.createdAt as Date;
      const firstResponse = t.firstResponseAt;
      const resolved = t.resolvedAt;
      return {
        id: t.id,
        ticketNumber: t.ticketNumber,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: created,
        firstResponseAt: firstResponse,
        resolvedAt: resolved,
        firstResponseHours: firstResponse
          ? hoursBetween(created, firstResponse as Date)
          : null,
        resolutionHours: resolved ? hoursBetween(created, resolved as Date) : null,
      };
    }),
    total,
  };
}

async function vendorKycCompliance(filters: ReportFilters) {
  assertReportRange(filters);
  const selectSql = `
    SELECT
      v.id AS "vendorId",
      v."businessName" AS "vendorName",
      v.status::text AS status,
      COALESCE(v."gstNumber", '') AS "vendorGstin",
      COUNT(vd.id) FILTER (WHERE vd.verified = true)::int AS "verifiedDocs",
      COUNT(vd.id) FILTER (WHERE vd.verified = false AND vd."rejectedAt" IS NULL)::int AS "pendingDocs",
      COUNT(vd.id) FILTER (WHERE vd."rejectedAt" IS NOT NULL)::int AS "rejectedDocs",
      CASE
        WHEN COUNT(vd.id) FILTER (WHERE vd.verified = false AND vd."rejectedAt" IS NULL) > 0 THEN 'PENDING'
        WHEN COUNT(vd.id) FILTER (WHERE vd."rejectedAt" IS NOT NULL) > 0 THEN 'ACTION_REQUIRED'
        WHEN COUNT(vd.id) FILTER (WHERE vd.verified = true) > 0 THEN 'COMPLIANT'
        ELSE 'NO_DOCUMENTS'
      END AS "complianceStatus"
    FROM vendors v
    LEFT JOIN vendor_documents vd ON vd."vendorId" = v.id AND vd."deletedAt" IS NULL
    WHERE v."deletedAt" IS NULL
      AND v."createdAt" <= :to
      ${filters.vendorId ? 'AND v.id = :vendorId' : ''}
    GROUP BY v.id, v."businessName", v.status, v."gstNumber"
  `;
  const replacements = { ...sqlReplacements(filters) };
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"vendorName" ASC`,
    replacements,
    filters,
    mapRow: (row) => ({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      status: row.status,
      vendorGstin: row.vendorGstin,
      verifiedDocs: Number(row.verifiedDocs ?? 0),
      pendingDocs: Number(row.pendingDocs ?? 0),
      rejectedDocs: Number(row.rejectedDocs ?? 0),
      complianceStatus: row.complianceStatus,
    }),
  });
}

async function customerWalletStatement(filters: ReportFilters) {
  assertReportRange(filters);
  if (!filters.userId) return emptyPage(filters);

  const { rows, total } = await pagedFindAndCount(
    WalletLedger,
    {
      where: {
        userId: filters.userId,
        createdAt: dateBetween(filters.from, filters.to),
      },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      balanceAfter: Number(row.balanceAfter),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      description: row.description,
      createdAt: row.createdAt,
    })),
    total,
  };
}

async function vendorPayoutReconciliation(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorFilter = `AND (:vendorId::uuid IS NULL OR p."vendorId" = :vendorId)`;
  const selectSql = `
    SELECT
      p.id AS "payoutId",
      p."vendorId" AS "vendorId",
      v."businessName" AS "vendorName",
      p.amount::float AS amount,
      p.status::text AS status,
      p."periodStart" AS "periodStart",
      p."periodEnd" AS "periodEnd",
      COALESCE(p."razorpayPayoutId", '') AS "razorpayPayoutId",
      p."paidAt" AS "paidAt",
      p."createdAt" AS "createdAt",
      CASE
        WHEN p.status = 'PAID' AND p."razorpayPayoutId" IS NOT NULL THEN 'MATCHED'
        WHEN p.status = 'PAID' AND p."razorpayPayoutId" IS NULL THEN 'MISSING_PG_REF'
        WHEN p.status = 'PROCESSING' THEN 'IN_FLIGHT'
        WHEN p.status = 'FAILED' THEN 'FAILED'
        WHEN p.status = 'PENDING' THEN 'PENDING'
        ELSE 'REVIEW'
      END AS "reconStatus"
    FROM payouts p
    INNER JOIN vendors v ON v.id = p."vendorId" AND v."deletedAt" IS NULL
    WHERE p."deletedAt" IS NULL
      AND p."createdAt" BETWEEN :from AND :to
      ${vendorFilter}
  `;
  return pagedSqlQuery({
    selectSql,
    orderBySql: `"createdAt" DESC`,
    replacements: sqlReplacements(filters),
    filters,
    mapRow: (row) => ({
      payoutId: row.payoutId,
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      amount: Number(row.amount ?? 0),
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      razorpayPayoutId: row.razorpayPayoutId,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
      reconStatus: row.reconStatus,
    }),
  });
}

async function newsletterSubscribers(filters: ReportFilters) {
  assertReportRange(filters);
  const { rows, total } = await pagedFindAndCount(
    NewsletterSubscriber,
    {
      where: { createdAt: dateBetween(filters.from, filters.to) },
      order: [['createdAt', 'DESC']],
    },
    filters,
  );
  return {
    rows: rows.map((row) => ({
      email: row.email,
      subscribedAt: row.createdAt,
    })),
    total,
  };
}

const taxInvoiceRegisterColumns = [
  { key: 'subOrderId', labelKey: 'subOrderId' },
  { key: 'orderId', labelKey: 'orderId' },
  { key: 'vendorId', labelKey: 'vendorId' },
  { key: 'vendorName', labelKey: 'vendorName' },
  { key: 'vendorGstin', labelKey: 'vendorGstin' },
  { key: 'taxInvoiceNumber', labelKey: 'taxInvoiceNumber' },
  { key: 'taxInvoiceIssuedAt', labelKey: 'taxInvoiceIssuedAt', format: 'date' as const },
  { key: 'taxable', labelKey: 'taxable', format: 'currency' as const },
  { key: 'tax', labelKey: 'taxAmount', format: 'currency' as const },
  { key: 'total', labelKey: 'totalAmount', format: 'currency' as const },
  { key: 'paymentMethod', labelKey: 'paymentMethod' },
  { key: 'paymentStatus', labelKey: 'paymentStatus' },
  { key: 'buyerGstin', labelKey: 'buyerGstin' },
  { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
];

export const adminFinanceGapReports: ReportDefinition[] = [
  {
    type: 'tax-invoice-register',
    labelKey: 'reportTaxInvoiceRegister',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: taxInvoiceRegisterColumns,
    query: taxInvoiceRegister,
  },
  {
    type: 'b2b-gstin-sales-register',
    labelKey: 'reportB2bGstinSalesRegister',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'taxInvoiceNumber', labelKey: 'taxInvoiceNumber' },
      { key: 'taxInvoiceIssuedAt', labelKey: 'taxInvoiceIssuedAt', format: 'date' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'buyerGstin', labelKey: 'buyerGstin' },
      { key: 'buyerName', labelKey: 'buyerName' },
      { key: 'placeOfSupplyState', labelKey: 'placeOfSupplyState' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'tax', labelKey: 'taxAmount', format: 'currency' },
      { key: 'total', labelKey: 'totalAmount', format: 'currency' },
    ],
    query: b2bGstinSalesRegister,
  },
  {
    type: 'gstr-1-filing',
    labelKey: 'reportGstr1Filing',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'section', labelKey: 'section' },
      { key: 'documentNumber', labelKey: 'documentNumber' },
      { key: 'documentDate', labelKey: 'documentDate', format: 'date' },
      { key: 'recipientGstin', labelKey: 'recipientGstin' },
      { key: 'state', labelKey: 'state' },
      { key: 'hsnCode', labelKey: 'hsnCode' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'taxable', labelKey: 'taxable', format: 'currency' },
      { key: 'tax', labelKey: 'taxAmount', format: 'currency' },
    ],
    query: gstr1Filing,
  },
  {
    type: 'gstr-3b-summary',
    labelKey: 'reportGstr3bSummary',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'line', labelKey: 'line' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
    ],
    query: gstr3bSummary,
  },
  {
    type: 'payment-gateway-reconciliation',
    labelKey: 'reportPaymentGatewayReconciliation',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'paymentMethod', labelKey: 'paymentMethod' },
      { key: 'paymentStatus', labelKey: 'paymentStatus' },
      { key: 'razorpayOrderId', labelKey: 'razorpayOrderId' },
      { key: 'razorpayPaymentId', labelKey: 'razorpayPaymentId' },
      { key: 'razorpayAmount', labelKey: 'razorpayAmount', format: 'currency' },
      { key: 'orderTotal', labelKey: 'totalAmount', format: 'currency' },
      { key: 'walletUsed', labelKey: 'walletUsed', format: 'currency' },
      { key: 'reconStatus', labelKey: 'reconStatus' },
    ],
    query: paymentGatewayReconciliation,
  },
  {
    type: 'cod-remittance',
    labelKey: 'reportCodRemittance',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'orderStatus', labelKey: 'orderStatus' },
      { key: 'paymentStatus', labelKey: 'paymentStatus' },
      { key: 'codAmount', labelKey: 'codAmount', format: 'currency' },
      { key: 'walletUsed', labelKey: 'walletUsed', format: 'currency' },
      { key: 'codStatus', labelKey: 'codStatus' },
    ],
    query: codRemittance,
  },
  {
    type: 'customer-analytics',
    labelKey: 'reportCustomerAnalytics',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'userId', labelKey: 'userId' },
      { key: 'email', labelKey: 'email' },
      { key: 'name', labelKey: 'name' },
      { key: 'orderCount', labelKey: 'orderCount', format: 'number' },
      { key: 'totalSpent', labelKey: 'totalSpent', format: 'currency' },
      { key: 'firstOrderAt', labelKey: 'firstOrderAt', format: 'date' },
      { key: 'lastOrderAt', labelKey: 'lastOrderAt', format: 'date' },
      { key: 'segment', labelKey: 'segment' },
    ],
    query: customerAnalytics,
  },
  {
    type: 'vendor-payout-reconciliation',
    labelKey: 'reportVendorPayoutReconciliation',
    audience: 'admin_finance',
    permissions: [PERMISSIONS.PAYOUT_MANAGE, PERMISSIONS.COMMISSION_VIEW],
    vendorScoped: false,
    financial: true,
    columns: [
      { key: 'payoutId', labelKey: 'payoutId' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'amount', labelKey: 'payoutAmount', format: 'currency' },
      { key: 'status', labelKey: 'payoutStatus' },
      { key: 'periodStart', labelKey: 'periodStart', format: 'date' },
      { key: 'periodEnd', labelKey: 'periodEnd', format: 'date' },
      { key: 'razorpayPayoutId', labelKey: 'razorpayPayoutId' },
      { key: 'paidAt', labelKey: 'paidAt', format: 'date' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'reconStatus', labelKey: 'reconStatus' },
    ],
    query: vendorPayoutReconciliation,
  },
];

export const adminOpsGapReports: ReportDefinition[] = [
  {
    type: 'shipping-logistics',
    labelKey: 'reportShippingLogistics',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'subOrderId', labelKey: 'subOrderId' },
      { key: 'orderId', labelKey: 'orderId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'shippingCost', labelKey: 'shippingCost', format: 'currency' },
      { key: 'shippingCharged', labelKey: 'shippingCharged', format: 'currency' },
      { key: 'carrier', labelKey: 'carrier' },
      { key: 'shipmentStatus', labelKey: 'shipmentStatus' },
      { key: 'shippedAt', labelKey: 'shippedAt', format: 'date' },
      { key: 'deliveredAt', labelKey: 'deliveredAt', format: 'date' },
    ],
    query: shippingLogistics,
  },
  {
    type: 'abandoned-cart',
    labelKey: 'reportAbandonedCart',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'cartId', labelKey: 'cartId' },
      { key: 'userId', labelKey: 'userId' },
      { key: 'userEmail', labelKey: 'email' },
      { key: 'userName', labelKey: 'name' },
      { key: 'lastActivityAt', labelKey: 'lastActivityAt', format: 'date' },
      { key: 'itemCount', labelKey: 'itemCount', format: 'number' },
      { key: 'cartValue', labelKey: 'cartValue', format: 'currency' },
    ],
    query: abandonedCartReport,
  },
  {
    type: 'support-ticket-sla',
    labelKey: 'reportSupportTicketSla',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ORDER_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'ticketNumber', labelKey: 'ticketNumber' },
      { key: 'category', labelKey: 'category' },
      { key: 'priority', labelKey: 'priority' },
      { key: 'status', labelKey: 'status' },
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'firstResponseAt', labelKey: 'firstResponseAt', format: 'date' },
      { key: 'resolvedAt', labelKey: 'resolvedAt', format: 'date' },
      { key: 'firstResponseHours', labelKey: 'firstResponseHours', format: 'number' },
      { key: 'resolutionHours', labelKey: 'resolutionHours', format: 'number' },
    ],
    query: supportTicketSla,
  },
  {
    type: 'vendor-kyc-compliance',
    labelKey: 'reportVendorKycCompliance',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.VENDOR_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'status', labelKey: 'status' },
      { key: 'vendorGstin', labelKey: 'vendorGstin' },
      { key: 'verifiedDocs', labelKey: 'verifiedDocs', format: 'number' },
      { key: 'pendingDocs', labelKey: 'pendingDocs', format: 'number' },
      { key: 'rejectedDocs', labelKey: 'rejectedDocs', format: 'number' },
      { key: 'complianceStatus', labelKey: 'complianceStatus' },
    ],
    query: vendorKycCompliance,
  },
  {
    type: 'newsletter-subscribers',
    labelKey: 'reportNewsletterSubscribers',
    audience: 'admin_ops',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'email', labelKey: 'email' },
      { key: 'subscribedAt', labelKey: 'subscribedAt', format: 'date' },
    ],
    query: newsletterSubscribers,
  },
];

export const adminCatalogGapReports: ReportDefinition[] = [
  {
    type: 'platform-inventory',
    labelKey: 'reportPlatformInventory',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.PRODUCT_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'sku', labelKey: 'sku' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'vendorName', labelKey: 'vendorName' },
      { key: 'stock', labelKey: 'stock', format: 'number' },
      { key: 'lowStockAt', labelKey: 'lowStockAt', format: 'number' },
      { key: 'isLowStock', labelKey: 'isLowStock' },
      { key: 'price', labelKey: 'price', format: 'currency' },
      { key: 'valuation', labelKey: 'valuation', format: 'currency' },
    ],
    query: platformInventory,
  },
];

export const vendorOwnerGapReports: ReportDefinition[] = [
  {
    type: 'vendor-tax-invoice-register',
    labelKey: 'reportTaxInvoiceRegister',
    audience: 'vendor_owner',
    permissions: [PERMISSIONS.PAYOUT_VIEW],
    vendorScoped: true,
    financial: true,
    columns: taxInvoiceRegisterColumns,
    query: taxInvoiceRegister,
  },
];

export const customerGapReports: ReportDefinition[] = [
  {
    type: 'customer-wallet-statement',
    labelKey: 'reportCustomerWalletStatement',
    audience: 'customer',
    permissions: [],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'createdAt', labelKey: 'createdAt', format: 'date' },
      { key: 'type', labelKey: 'type' },
      { key: 'amount', labelKey: 'amount', format: 'currency' },
      { key: 'balanceAfter', labelKey: 'balanceAfter', format: 'currency' },
      { key: 'referenceType', labelKey: 'referenceType' },
      { key: 'referenceId', labelKey: 'referenceId' },
      { key: 'description', labelKey: 'description' },
    ],
    query: customerWalletStatement,
  },
];

export const reportGapDefinitions: ReportDefinition[] = [
  ...adminFinanceGapReports,
  ...adminOpsGapReports,
  ...adminCatalogGapReports,
  ...vendorOwnerGapReports,
  ...customerGapReports,
];
