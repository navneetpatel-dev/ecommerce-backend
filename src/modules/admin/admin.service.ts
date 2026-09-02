import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { Product } from '@database/models/product.model';
import { Review } from '@database/models/review.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import { fromPaise } from '@modules/pricing/money';
import { REPORTABLE_ORDER_SQL, sqlFrozenPaise } from '@modules/pricing/frozenMoneySql';
import {
  PRODUCT_STATUS,
  PAYMENT_STATUS,
  VENDOR_STATUS,
  REVIEW_STATUS,
  ORDER_STATUS,
} from '@core/constants/statuses';

export type DashboardMetrics = {
  totalOrders: number;
  totalRevenue: number;
  totalVendors: number;
  totalCustomers: number;
  pendingApprovals: number;
};

export type PlatformAnalytics = {
  gmv: number;
  paidGmv: number;
  aov: number;
  totalOrders: number;
  totalCustomers: number;
  totalVendors: number;
  cancellationRate: number;
  returnRate: number;
  pendingProducts: number;
  pendingVendors: number;
  pendingReviews: number;
  ordersGrowthPct: number;
  revenueGrowthPct: number;
  /** `sharePercent` is the row's share of platform-wide revenue, not of the top 8. */
  topVendors: Array<{
    id: string;
    businessName: string;
    revenue: number;
    sharePercent: number;
  }>;
  topCategories: Array<{ id: string; name: string; revenue: number; sharePercent: number }>;
  orderVolume: Array<{ date: string; count: number; revenue: number }>;
  ordersByStatus: Array<{ status: string; count: number }>;
  paymentsByStatus: Array<{ status: string; count: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
};

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

/** Row share of the platform-wide total, computed in paise to avoid rupee drift. */
function sharePercent(rowPaise: unknown, totalPaise: unknown): number {
  const row = Number(rowPaise ?? 0);
  const total = Number(totalPaise ?? 0);
  if (total <= 0) return 0;
  return Number(((row / total) * 100).toFixed(1));
}

export const adminService = {
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [totalOrders, totalVendors, totalCustomers, pendingApprovals, revenue] =
      await Promise.all([
        Order.count(),
        Vendor.count(),
        User.count(),
        Product.count({ where: { status: PRODUCT_STATUS.PENDING_APPROVAL } }),
        Order.sum('totalAmount'),
      ]);

    return {
      totalOrders,
      totalRevenue: Number(revenue ?? 0),
      totalVendors,
      totalCustomers,
      pendingApprovals,
    };
  },

  async getPlatformAnalytics(): Promise<PlatformAnalytics> {
    const [
      paidGmv,
      allGmv,
      totalOrders,
      totalVendors,
      totalCustomers,
      cancelledOrders,
      returnCount,
      pendingProducts,
      pendingVendors,
      pendingReviews,
      topVendorRows,
      topCategoryRows,
      orderVolumeRows,
      ordersByStatusRows,
      paymentsByStatusRows,
      ratingRows,
      growthRows,
    ] = await Promise.all([
      Order.sum('totalAmount', { where: { paymentStatus: [PAYMENT_STATUS.PAID] as any } }),
      Order.sum('totalAmount'),
      Order.count(),
      Vendor.count(),
      User.count(),
      Order.count({ where: { status: ORDER_STATUS.CANCELLED } }),
      ReturnRequest.count(),
      Product.count({ where: { status: PRODUCT_STATUS.PENDING_APPROVAL } }),
      Vendor.count({ where: { status: VENDOR_STATUS.PENDING } }),
      Review.count({ where: { status: REVIEW_STATUS.PENDING } }),
      // Ranked revenue reads the frozen sub-order snapshot, gated on the same
      // "which orders count" rule the settlement reports use. `sharePercent` is
      // computed here against the platform-wide total — never client-side, and
      // never against the truncated top-N.
      sequelize.query<{
        id: string;
        businessName: string;
        revenuePaise: string;
        totalPaise: string;
      }>(
        `WITH vendor_revenue AS (
           SELECT v.id, v."businessName",
                  COALESCE(SUM(${sqlFrozenPaise('so', 'subtotalPaise', 'subtotal')}), 0)::bigint AS "revenuePaise"
           FROM vendors v
           LEFT JOIN sub_orders so
             ON so."vendorId" = v.id
            AND so.status <> '${ORDER_STATUS.CANCELLED}'
            AND so."deletedAt" IS NULL
           LEFT JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
           WHERE v."deletedAt" IS NULL
             AND (so.id IS NULL OR ${REPORTABLE_ORDER_SQL})
           GROUP BY v.id, v."businessName"
         )
         SELECT id, "businessName", "revenuePaise",
                COALESCE(SUM("revenuePaise") OVER (), 0)::bigint AS "totalPaise"
         FROM vendor_revenue
         ORDER BY "revenuePaise" DESC
         LIMIT 8`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ id: string; name: string; revenuePaise: string; totalPaise: string }>(
        `WITH category_revenue AS (
           SELECT c.id, c.name,
                  COALESCE(SUM(${sqlFrozenPaise('oi', 'taxableAmountPaise', 'taxableAmount')}), 0)::bigint AS "revenuePaise"
           FROM categories c
           JOIN products p ON p."categoryId" = c.id
           JOIN product_variants pv ON pv."productId" = p.id
           JOIN order_items oi ON oi."variantId" = pv.id AND oi."deletedAt" IS NULL
           JOIN sub_orders so
             ON so.id = oi."subOrderId"
            AND so.status <> '${ORDER_STATUS.CANCELLED}'
            AND so."deletedAt" IS NULL
           JOIN orders o ON o.id = so."orderId" AND o."deletedAt" IS NULL
           WHERE c."deletedAt" IS NULL
             AND ${REPORTABLE_ORDER_SQL}
           GROUP BY c.id, c.name
         )
         SELECT id, name, "revenuePaise",
                COALESCE(SUM("revenuePaise") OVER (), 0)::bigint AS "totalPaise"
         FROM category_revenue
         ORDER BY "revenuePaise" DESC
         LIMIT 8`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ date: string; count: string; revenue: string }>(
        `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
                COUNT(*)::int AS count,
                COALESCE(SUM("totalAmount"), 0)::numeric AS revenue
         FROM orders
         WHERE "createdAt" >= NOW() - INTERVAL '30 days'
           AND status <> 'CANCELLED'
           AND "deletedAt" IS NULL
         GROUP BY date_trunc('day', "createdAt")
         ORDER BY date_trunc('day', "createdAt") ASC`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::int AS count
         FROM orders
         WHERE "deletedAt" IS NULL
         GROUP BY status
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ status: string; count: string }>(
        `SELECT "paymentStatus" AS status, COUNT(*)::int AS count
         FROM orders
         WHERE "deletedAt" IS NULL
         GROUP BY "paymentStatus"
         ORDER BY count DESC`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ rating: string; count: string }>(
        `SELECT rating::int AS rating, COUNT(*)::int AS count
         FROM reviews
         WHERE "deletedAt" IS NULL AND status = 'APPROVED'
         GROUP BY rating
         ORDER BY rating ASC`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{
        ordersCurrent: string;
        ordersPrevious: string;
        revenueCurrent: string;
        revenuePrevious: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '14 days')::int AS "ordersCurrent",
           COUNT(*) FILTER (
             WHERE "createdAt" >= NOW() - INTERVAL '28 days'
               AND "createdAt" < NOW() - INTERVAL '14 days'
           )::int AS "ordersPrevious",
           COALESCE(SUM("totalAmount") FILTER (WHERE "createdAt" >= NOW() - INTERVAL '14 days'), 0)::numeric AS "revenueCurrent",
           COALESCE(SUM("totalAmount") FILTER (
             WHERE "createdAt" >= NOW() - INTERVAL '28 days'
               AND "createdAt" < NOW() - INTERVAL '14 days'
           ), 0)::numeric AS "revenuePrevious"
         FROM orders
         WHERE status <> 'CANCELLED' AND "deletedAt" IS NULL`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    const paid = Number(paidGmv ?? 0);
    const all = Number(allGmv ?? 0);
    const gmv = paid || all;
    const orderTotal = Number(totalOrders ?? 0);
    const cancelled = Number(cancelledOrders ?? 0);
    const returns = Number(returnCount ?? 0);
    const growth = growthRows[0];

    const ratingMap = new Map(
      ratingRows.map((row) => [Number(row.rating), Number(row.count ?? 0)]),
    );

    return {
      gmv,
      paidGmv: paid,
      aov: orderTotal > 0 ? Number((gmv / orderTotal).toFixed(2)) : 0,
      totalOrders: orderTotal,
      totalCustomers: Number(totalCustomers ?? 0),
      totalVendors: Number(totalVendors ?? 0),
      cancellationRate: orderTotal > 0 ? Number(((cancelled / orderTotal) * 100).toFixed(1)) : 0,
      returnRate: orderTotal > 0 ? Number(((returns / orderTotal) * 100).toFixed(1)) : 0,
      pendingProducts: Number(pendingProducts ?? 0),
      pendingVendors: Number(pendingVendors ?? 0),
      pendingReviews: Number(pendingReviews ?? 0),
      ordersGrowthPct: pctChange(
        Number(growth?.ordersCurrent ?? 0),
        Number(growth?.ordersPrevious ?? 0),
      ),
      revenueGrowthPct: pctChange(
        Number(growth?.revenueCurrent ?? 0),
        Number(growth?.revenuePrevious ?? 0),
      ),
      topVendors: topVendorRows.map((row) => ({
        id: row.id,
        businessName: row.businessName,
        revenue: fromPaise(Number(row.revenuePaise ?? 0)),
        sharePercent: sharePercent(row.revenuePaise, row.totalPaise),
      })),
      topCategories: topCategoryRows.map((row) => ({
        id: row.id,
        name: row.name,
        revenue: fromPaise(Number(row.revenuePaise ?? 0)),
        sharePercent: sharePercent(row.revenuePaise, row.totalPaise),
      })),
      orderVolume: orderVolumeRows.map((row) => ({
        date: row.date,
        count: Number(row.count ?? 0),
        revenue: Number(row.revenue ?? 0),
      })),
      ordersByStatus: ordersByStatusRows.map((row) => ({
        status: row.status,
        count: Number(row.count ?? 0),
      })),
      paymentsByStatus: paymentsByStatusRows.map((row) => ({
        status: row.status,
        count: Number(row.count ?? 0),
      })),
      ratingDistribution: [1, 2, 3, 4, 5].map((rating) => ({
        rating,
        count: ratingMap.get(rating) ?? 0,
      })),
    };
  },
};
