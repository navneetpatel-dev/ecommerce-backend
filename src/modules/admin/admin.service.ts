import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { Product } from '@database/models/product.model';
import { Review } from '@database/models/review.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { Role } from '@database/models/role.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
import { fromPaise } from '@modules/pricing/money';
import { sqlIstDay } from '@modules/pricing/istCalendar';
import {
  GMV_SUB_ORDER_SQL,
  sqlGmvPaise,
  sqlLineSubtotalPaise,
} from '@modules/pricing/frozenMoneySql';
import {
  PRODUCT_STATUS,
  PAYMENT_STATUS,
  VENDOR_STATUS,
  REVIEW_STATUS,
  ORDER_STATUS,
  ROLES,
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

/**
 * Platform GMV, paid GMV, order count and AOV from the one GMV definition the
 * settlement reports use (see GMV_SUB_ORDER_SQL). `orderCount` is the orders that
 * contribute GMV — paid online orders and placed COD orders, never unpaid, failed
 * or cancelled ones — so the dashboard's order total, AOV and GMV describe the
 * same set of orders.
 */
async function queryGmvTotals(): Promise<{
  gmvPaise: number;
  paidGmvPaise: number;
  orderCount: number;
  aovPaise: number | null;
}> {
  const [row] = await sequelize.query<{
    gmvPaise: string;
    paidGmvPaise: string;
    orderCount: string;
  }>(
    `SELECT
       COALESCE(SUM(${sqlGmvPaise('s')}), 0)::bigint AS "gmvPaise",
       COALESCE(SUM(${sqlGmvPaise('s')}) FILTER (
         WHERE o."paymentStatus" = '${PAYMENT_STATUS.PAID}'
       ), 0)::bigint AS "paidGmvPaise",
       COUNT(DISTINCT o.id)::int AS "orderCount"
     FROM sub_orders s
     INNER JOIN orders o ON o.id = s."orderId"
     WHERE ${GMV_SUB_ORDER_SQL}`,
    { type: QueryTypes.SELECT },
  );
  const gmvPaise = Number(row?.gmvPaise ?? 0);
  const orderCount = Number(row?.orderCount ?? 0);
  return {
    gmvPaise,
    paidGmvPaise: Number(row?.paidGmvPaise ?? 0),
    orderCount,
    aovPaise: orderCount > 0 ? Math.round(gmvPaise / orderCount) : null,
  };
}

export const adminService = {
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [totalVendors, totalCustomers, pendingApprovals, revenue] =
      await Promise.all([
        Vendor.count(),
        User.count({
          include: [{
            model: Role,
            as: 'role',
            where: { name: ROLES.CUSTOMER },
          }],
        }),
        Product.count({ where: { status: PRODUCT_STATUS.PENDING_APPROVAL } }),
        queryGmvTotals(),
      ]);

    return {
      totalOrders: revenue.orderCount,
      totalRevenue: fromPaise(revenue.gmvPaise),
      totalVendors,
      totalCustomers,
      pendingApprovals,
    };
  },

  async getPlatformAnalytics(): Promise<PlatformAnalytics> {
    const [
      gmvTotals,
      allOrders,
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
      queryGmvTotals(),
      Order.count(),
      Vendor.count(),
      User.count({
        include: [{
          model: Role,
          as: 'role',
          where: { name: ROLES.CUSTOMER },
        }],
      }),
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
                  COALESCE(SUM(g."gmvPaise"), 0)::bigint AS "revenuePaise"
           FROM vendors v
           LEFT JOIN (
             SELECT s."vendorId", ${sqlGmvPaise('s')} AS "gmvPaise"
             FROM sub_orders s
             INNER JOIN orders o ON o.id = s."orderId"
             WHERE ${GMV_SUB_ORDER_SQL}
           ) g ON g."vendorId" = v.id
           WHERE v."deletedAt" IS NULL
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
                  COALESCE(SUM(${sqlLineSubtotalPaise('oi')}), 0)::bigint AS "revenuePaise"
           FROM categories c
           JOIN products p ON p."categoryId" = c.id
           JOIN product_variants pv ON pv."productId" = p.id
           JOIN order_items oi ON oi."variantId" = pv.id AND oi."deletedAt" IS NULL
           JOIN sub_orders s ON s.id = oi."subOrderId"
           JOIN orders o ON o.id = s."orderId"
           WHERE c."deletedAt" IS NULL
             AND ${GMV_SUB_ORDER_SQL}
           GROUP BY c.id, c.name
         )
         SELECT id, name, "revenuePaise",
                COALESCE(SUM("revenuePaise") OVER (), 0)::bigint AS "totalPaise"
         FROM category_revenue
         ORDER BY "revenuePaise" DESC
         LIMIT 8`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ date: string; count: string; revenuePaise: string }>(
        `SELECT to_char(${sqlIstDay('o."createdAt"')}, 'YYYY-MM-DD') AS date,
                COUNT(DISTINCT o.id)::int AS count,
                COALESCE(SUM(${sqlGmvPaise('s')}), 0)::bigint AS "revenuePaise"
         FROM sub_orders s
         INNER JOIN orders o ON o.id = s."orderId"
         WHERE o."createdAt" >= NOW() - INTERVAL '30 days'
           AND ${GMV_SUB_ORDER_SQL}
         GROUP BY ${sqlIstDay('o."createdAt"')}
         ORDER BY ${sqlIstDay('o."createdAt"')} ASC`,
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
        revenueCurrentPaise: string;
        revenuePreviousPaise: string;
      }>(
        // Last 14 days vs the 14 before, over the same orders GMV counts: an
        // unpaid, failed or cancelled checkout is neither an order nor revenue.
        `SELECT
           COUNT(DISTINCT o.id) FILTER (
             WHERE o."createdAt" >= NOW() - INTERVAL '14 days'
           )::int AS "ordersCurrent",
           COUNT(DISTINCT o.id) FILTER (
             WHERE o."createdAt" < NOW() - INTERVAL '14 days'
           )::int AS "ordersPrevious",
           COALESCE(SUM(${sqlGmvPaise('s')}) FILTER (
             WHERE o."createdAt" >= NOW() - INTERVAL '14 days'
           ), 0)::bigint AS "revenueCurrentPaise",
           COALESCE(SUM(${sqlGmvPaise('s')}) FILTER (
             WHERE o."createdAt" < NOW() - INTERVAL '14 days'
           ), 0)::bigint AS "revenuePreviousPaise"
         FROM sub_orders s
         INNER JOIN orders o ON o.id = s."orderId"
         WHERE o."createdAt" >= NOW() - INTERVAL '28 days'
           AND ${GMV_SUB_ORDER_SQL}`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    // Cancellation and return rates keep every placed order row as their base: a
    // cancelled order is exactly what the rate measures, so it cannot come from
    // the GMV order set, which excludes cancellations.
    const orderRows = Number(allOrders ?? 0);
    const cancelled = Number(cancelledOrders ?? 0);
    const returns = Number(returnCount ?? 0);
    const growth = growthRows[0];

    const ratingMap = new Map(
      ratingRows.map((row) => [Number(row.rating), Number(row.count ?? 0)]),
    );

    return {
      gmv: fromPaise(gmvTotals.gmvPaise),
      paidGmv: fromPaise(gmvTotals.paidGmvPaise),
      aov: gmvTotals.aovPaise == null ? 0 : fromPaise(gmvTotals.aovPaise),
      totalOrders: gmvTotals.orderCount,
      totalCustomers: Number(totalCustomers ?? 0),
      totalVendors: Number(totalVendors ?? 0),
      cancellationRate: orderRows > 0 ? Number(((cancelled / orderRows) * 100).toFixed(1)) : 0,
      returnRate: orderRows > 0 ? Number(((returns / orderRows) * 100).toFixed(1)) : 0,
      pendingProducts: Number(pendingProducts ?? 0),
      pendingVendors: Number(pendingVendors ?? 0),
      pendingReviews: Number(pendingReviews ?? 0),
      ordersGrowthPct: pctChange(
        Number(growth?.ordersCurrent ?? 0),
        Number(growth?.ordersPrevious ?? 0),
      ),
      revenueGrowthPct: pctChange(
        Number(growth?.revenueCurrentPaise ?? 0),
        Number(growth?.revenuePreviousPaise ?? 0),
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
        revenue: fromPaise(Number(row.revenuePaise ?? 0)),
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
