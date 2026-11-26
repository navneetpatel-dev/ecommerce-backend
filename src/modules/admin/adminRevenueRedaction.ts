import type { DashboardMetrics, PlatformAnalytics } from './admin.service';

/**
 * Callers without `analytics.revenue` get operational numbers only. `DashboardMetrics.totalRevenue`
 * and the revenue-bearing fields of `PlatformAnalytics` (gmv, paidGmv, aov, revenueGrowthPct, each
 * day's revenue) are `null`, and the revenue rankings (top vendors and categories) are empty.
 */

/** Strips every revenue figure from the dashboard metrics. */
export function redactDashboardRevenue(metrics: DashboardMetrics): DashboardMetrics {
  return { ...metrics, totalRevenue: null };
}

/**
 * Strips GMV, AOV, revenue growth, the revenue rankings (top vendors and categories are ranked by
 * revenue) and the revenue of each day, keeping every count.
 */
export function redactPlatformRevenue(analytics: PlatformAnalytics): PlatformAnalytics {
  return {
    ...analytics,
    gmv: null,
    paidGmv: null,
    aov: null,
    revenueGrowthPct: null,
    topVendors: [],
    topCategories: [],
    orderVolume: analytics.orderVolume.map((row) => ({ ...row, revenue: null })),
  };
}
