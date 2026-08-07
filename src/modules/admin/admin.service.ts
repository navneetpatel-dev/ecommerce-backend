import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { Product } from '@database/models/product.model';
import { Review } from '@database/models/review.model';
import { ReturnRequest } from '@database/models/returnRequest.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';
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
  topVendors: Array<{ id: string; businessName: string; revenue: number }>;
  topCategories: Array<{ id: string; name: string; revenue: number }>;
  orderVolume: Array<{ date: string; count: number; revenue: number }>;
  ordersByStatus: Array<{ status: string; count: number }>;
  paymentsByStatus: Array<{ status: string; count: number }>;
  ratingDistribution: Array<{ rating: number; count: number }>;
};

function pctChange(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
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
      sequelize.query<{ id: string; businessName: string; revenue: string }>(
        `SELECT v.id, v."businessName",
                COALESCE(SUM(so.subtotal), 0)::numeric AS revenue
         FROM vendors v
         LEFT JOIN sub_orders so ON so."vendorId" = v.id AND so.status <> 'CANCELLED'
         WHERE v."deletedAt" IS NULL
         GROUP BY v.id, v."businessName"
         ORDER BY revenue DESC
         LIMIT 8`,
        { type: QueryTypes.SELECT },
      ),
      sequelize.query<{ id: string; name: string; revenue: string }>(
        `SELECT c.id, c.name,
                COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::numeric AS revenue
         FROM categories c
         JOIN products p ON p."categoryId" = c.id
         JOIN product_variants pv ON pv."productId" = p.id
         JOIN order_items oi ON oi."variantId" = pv.id
         WHERE c."deletedAt" IS NULL
         GROUP BY c.id, c.name
         ORDER BY revenue DESC
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
        revenue: Number(row.revenue ?? 0),
      })),
      topCategories: topCategoryRows.map((row) => ({
        id: row.id,
        name: row.name,
        revenue: Number(row.revenue ?? 0),
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
