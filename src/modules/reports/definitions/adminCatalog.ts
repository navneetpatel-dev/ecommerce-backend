import { Op } from 'sequelize';
import { PERMISSIONS } from '@core/permissions/permissionKeys';
import { PRODUCT_STATUS } from '@core/constants/statuses';
import { Product } from '@database/models/product.model';
import { Category } from '@database/models/category.model';
import type { ReportDefinition, ReportFilters } from '../engine/types';
import { createOffsetExportQuery } from '../engine/export/createOffsetExportQuery';
import {
  assertReportRange,
  fromPaise,
  pagedFindAndCount,
  pagedSqlQuery,
  dateBetween,
  REPORTABLE_ORDER_SQL,
} from '../engine/queryHelpers';
import { sqlFrozenPaise } from '@modules/pricing/frozenMoneySql';

function resolveVendorId(filters: ReportFilters): string | null {
  return filters.scopedVendorId ?? filters.vendorId ?? null;
}

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100;
}

const TAXABLE_PAISE_SQL = sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount');

async function productPerformance(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  if (vendorId) replacements.vendorId = vendorId;
  if (filters.categoryId) replacements.categoryId = filters.categoryId;

  const selectSql = `
    SELECT
      p.id AS "productId",
      p.name AS "productName",
      p."categoryId" AS "categoryId",
      SUM(oi.quantity)::int AS qty,
      SUM(${TAXABLE_PAISE_SQL})::bigint AS "revenuePaise"
    FROM order_items oi
    INNER JOIN sub_orders so
      ON so.id = oi."subOrderId"
      AND so."deletedAt" IS NULL
    INNER JOIN orders o
      ON o.id = so."orderId"
      AND o."deletedAt" IS NULL
    INNER JOIN product_variants pv
      ON pv.id = oi."variantId"
      AND pv."deletedAt" IS NULL
    INNER JOIN products p
      ON p.id = pv."productId"
      AND p."deletedAt" IS NULL
    WHERE oi."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      ${vendorId ? 'AND so."vendorId" = :vendorId' : ''}
      ${filters.categoryId ? 'AND p."categoryId" = :categoryId' : ''}
    GROUP BY p.id, p.name, p."categoryId"
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"revenuePaise" DESC`,
    replacements,
    filters,
    mapRow: (row) => ({
      productId: row.productId,
      productName: row.productName,
      categoryId: row.categoryId,
      qty: Number(row.qty ?? 0),
      revenue: fromPaise(Number(row.revenuePaise ?? 0)),
    }),
  });
}

async function categoryPerformance(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  if (vendorId) replacements.vendorId = vendorId;
  if (filters.categoryId) replacements.categoryId = filters.categoryId;

  const selectSql = `
    SELECT
      p."categoryId" AS "categoryId",
      COALESCE(MAX(c.name), p."categoryId"::text) AS "categoryName",
      SUM(oi.quantity)::int AS qty,
      SUM(${TAXABLE_PAISE_SQL})::bigint AS "revenuePaise"
    FROM order_items oi
    INNER JOIN sub_orders so
      ON so.id = oi."subOrderId"
      AND so."deletedAt" IS NULL
    INNER JOIN orders o
      ON o.id = so."orderId"
      AND o."deletedAt" IS NULL
    INNER JOIN product_variants pv
      ON pv.id = oi."variantId"
      AND pv."deletedAt" IS NULL
    INNER JOIN products p
      ON p.id = pv."productId"
      AND p."deletedAt" IS NULL
    LEFT JOIN categories c
      ON c.id = p."categoryId"
      AND c."deletedAt" IS NULL
    WHERE oi."deletedAt" IS NULL
      AND o."createdAt" BETWEEN :from AND :to
      AND ${REPORTABLE_ORDER_SQL}
      ${vendorId ? 'AND so."vendorId" = :vendorId' : ''}
      ${filters.categoryId ? 'AND p."categoryId" = :categoryId' : ''}
    GROUP BY p."categoryId"
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"revenuePaise" DESC`,
    replacements,
    filters,
    mapRow: (row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      qty: Number(row.qty ?? 0),
      revenue: fromPaise(Number(row.revenuePaise ?? 0)),
    }),
  });
}

async function productApprovalTat(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const where: Record<string, unknown> = {
    [Op.or]: [
      { createdAt: dateBetween(filters.from, filters.to) },
      { updatedAt: dateBetween(filters.from, filters.to) },
    ],
  };
  if (vendorId) where.vendorId = vendorId;
  if (filters.status) where.status = filters.status;

  const { rows, total } = await pagedFindAndCount(
    Product,
    {
      where,
      include: [{ model: Category, attributes: ['id', 'name'], required: false }],
      order: [['updatedAt', 'DESC']],
    },
    filters,
  );

  return {
    rows: rows.map((p) => {
      const submittedAt = p.createdAt as Date;
      const approved =
        p.status === PRODUCT_STATUS.LIVE || p.approvedById != null;
      const decidedAt =
        approved || p.status === PRODUCT_STATUS.REJECTED
          ? (p.updatedAt as Date)
          : null;
      return {
        productId: p.id,
        productName: p.name,
        vendorId: p.vendorId,
        categoryId: p.categoryId,
        categoryName: (p as Product & { Category?: Category }).Category?.name ?? null,
        status: p.status,
        submittedAt,
        decidedAt,
        turnaroundHours: decidedAt ? hoursBetween(submittedAt, decidedAt) : null,
        approvedById: p.approvedById,
      };
    }),
    total,
  };
}

async function reviewRatingSummary(filters: ReportFilters) {
  assertReportRange(filters);
  const vendorId = resolveVendorId(filters);
  const replacements: Record<string, unknown> = {
    from: filters.from,
    to: filters.to,
  };
  if (filters.status) replacements.status = filters.status;
  if (filters.categoryId) replacements.categoryId = filters.categoryId;
  if (vendorId) replacements.vendorId = vendorId;

  const selectSql = `
    SELECT
      p.id AS "productId",
      p.name AS "productName",
      ROUND(AVG(r.rating)::numeric, 2) AS "avgRating",
      COUNT(*)::int AS "reviewCount",
      SUM(CASE WHEN r.status = 'APPROVED' THEN 1 ELSE 0 END)::int AS "approvedCount",
      SUM(CASE WHEN r.status = 'PENDING' THEN 1 ELSE 0 END)::int AS "pendingCount",
      SUM(CASE WHEN r.status = 'REJECTED' THEN 1 ELSE 0 END)::int AS "rejectedCount"
    FROM reviews r
    INNER JOIN products p
      ON p.id = r."productId"
      AND p."deletedAt" IS NULL
    WHERE r."deletedAt" IS NULL
      AND r."createdAt" BETWEEN :from AND :to
      ${filters.status ? 'AND r.status = :status' : ''}
      ${filters.categoryId ? 'AND p."categoryId" = :categoryId' : ''}
      ${vendorId ? 'AND p."vendorId" = :vendorId' : ''}
    GROUP BY p.id, p.name
  `;

  return pagedSqlQuery({
    selectSql,
    orderBySql: `"reviewCount" DESC`,
    replacements,
    filters,
    mapRow: (row) => ({
      productId: row.productId,
      productName: row.productName,
      avgRating: Number(row.avgRating ?? 0),
      reviewCount: Number(row.reviewCount ?? 0),
      approvedCount: Number(row.approvedCount ?? 0),
      pendingCount: Number(row.pendingCount ?? 0),
      rejectedCount: Number(row.rejectedCount ?? 0),
    }),
  });
}

export const adminCatalogReports: ReportDefinition[] = [
  {
    type: 'product-performance',
    labelKey: 'reportProductPerformance',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.PRODUCT_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'productId', labelKey: 'productId' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'categoryId', labelKey: 'categoryId' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'revenue', labelKey: 'revenue', format: 'currency' },
    ],
    query: productPerformance,
    exportQuery: createOffsetExportQuery(productPerformance),
  },
  {
    type: 'category-performance',
    labelKey: 'reportCategoryPerformance',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.CATEGORY_MANAGE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'categoryId', labelKey: 'categoryId' },
      { key: 'categoryName', labelKey: 'categoryName' },
      { key: 'qty', labelKey: 'qty', format: 'number' },
      { key: 'revenue', labelKey: 'revenue', format: 'currency' },
    ],
    query: categoryPerformance,
    exportQuery: createOffsetExportQuery(categoryPerformance),
  },
  {
    type: 'product-approval-tat',
    labelKey: 'reportProductApprovalTat',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.PRODUCT_APPROVE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'productId', labelKey: 'productId' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'vendorId', labelKey: 'vendorId' },
      { key: 'categoryId', labelKey: 'categoryId' },
      { key: 'status', labelKey: 'status' },
      { key: 'submittedAt', labelKey: 'submittedAt', format: 'date' },
      { key: 'decidedAt', labelKey: 'decidedAt', format: 'date' },
      { key: 'turnaroundHours', labelKey: 'turnaroundHours', format: 'number' },
    ],
    query: productApprovalTat,
    exportQuery: createOffsetExportQuery(productApprovalTat),
  },
  {
    type: 'review-rating-summary',
    labelKey: 'reportReviewRatingSummary',
    audience: 'admin_catalog',
    permissions: [PERMISSIONS.REVIEW_MODERATE],
    vendorScoped: false,
    financial: false,
    columns: [
      { key: 'productId', labelKey: 'productId' },
      { key: 'productName', labelKey: 'productName' },
      { key: 'avgRating', labelKey: 'avgRating', format: 'number' },
      { key: 'reviewCount', labelKey: 'reviewCount', format: 'number' },
      { key: 'approvedCount', labelKey: 'approvedCount', format: 'number' },
      { key: 'pendingCount', labelKey: 'pendingCount', format: 'number' },
      { key: 'rejectedCount', labelKey: 'rejectedCount', format: 'number' },
    ],
    query: reviewRatingSummary,
    exportQuery: createOffsetExportQuery(reviewRatingSummary),
  },
];