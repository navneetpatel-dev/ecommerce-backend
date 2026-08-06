import { Order } from '@database/models/order.model';
import { Vendor } from '@database/models/vendor.model';
import { User } from '@database/models/user.model';
import { Product } from '@database/models/product.model';
import { sequelize } from '@database/models';
import { QueryTypes } from 'sequelize';

export type DashboardMetrics = {
  totalOrders: number;
  totalRevenue: number;
  totalVendors: number;
  totalCustomers: number;
  pendingApprovals: number;
};

export type PlatformAnalytics = {
  gmv: number;
  topVendors: Array<{ id: string; businessName: string; revenue: number }>;
  topCategories: Array<{ id: string; name: string; revenue: number }>;
  orderVolume: Array<{ date: string; count: number }>;
};

export const adminService = {
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const [totalOrders, totalVendors, totalCustomers, pendingApprovals, revenue] =
      await Promise.all([
        Order.count(),
        Vendor.count(),
        User.count(),
        Product.count({ where: { status: 'PENDING_APPROVAL' } }),
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
    const [paidGmv, allGmv, topVendorRows, topCategoryRows, orderVolumeRows] =
      await Promise.all([
        Order.sum('totalAmount', { where: { paymentStatus: ['PAID'] as any } }),
        Order.sum('totalAmount'),
        sequelize.query<{ id: string; businessName: string; revenue: string }>(
          `SELECT v.id, v."businessName",
                  COALESCE(SUM(so.subtotal), 0)::numeric AS revenue
           FROM vendors v
           LEFT JOIN sub_orders so ON so."vendorId" = v.id AND so.status <> 'CANCELLED'
           GROUP BY v.id, v."businessName"
           ORDER BY revenue DESC
           LIMIT 10`,
          { type: QueryTypes.SELECT },
        ),
        sequelize.query<{ id: string; name: string; revenue: string }>(
          `SELECT c.id, c.name,
                  COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::numeric AS revenue
           FROM categories c
           JOIN products p ON p."categoryId" = c.id
           JOIN product_variants pv ON pv."productId" = p.id
           JOIN order_items oi ON oi."variantId" = pv.id
           GROUP BY c.id, c.name
           ORDER BY revenue DESC
           LIMIT 10`,
          { type: QueryTypes.SELECT },
        ),
        sequelize.query<{ date: string; count: string }>(
          `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
                  COUNT(*)::int AS count
           FROM orders
           WHERE "createdAt" >= NOW() - INTERVAL '14 days'
             AND status <> 'CANCELLED'
           GROUP BY date_trunc('day', "createdAt")
           ORDER BY date_trunc('day', "createdAt") ASC`,
          { type: QueryTypes.SELECT },
        ),
      ]);

    return {
      gmv: Number(paidGmv ?? 0) || Number(allGmv ?? 0),
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
      })),
    };
  },
};
