import type { PlatformAnalytics } from './admin.service';
import { buildCsvBuffer } from '@modules/reports/engine/csvExporter';
import { buildExcelBuffer } from '@modules/reports/engine/excelExporter';
import { renderReportTablePdf } from '@core/pdf';

const SUMMARY_COLUMNS = [
  { key: 'metric', labelKey: 'metric' },
  { key: 'value', labelKey: 'value' },
];

function summaryRows(data: PlatformAnalytics): Record<string, unknown>[] {
  return [
    { metric: 'GMV', value: data.gmv },
    { metric: 'Paid GMV', value: data.paidGmv },
    { metric: 'AOV', value: data.aov },
    { metric: 'Total orders', value: data.totalOrders },
    { metric: 'Total customers', value: data.totalCustomers },
    { metric: 'Total vendors', value: data.totalVendors },
    { metric: 'Cancellation rate %', value: data.cancellationRate },
    { metric: 'Return rate %', value: data.returnRate },
    { metric: 'Orders growth %', value: data.ordersGrowthPct },
    { metric: 'Revenue growth %', value: data.revenueGrowthPct },
    { metric: 'Pending products', value: data.pendingProducts },
    { metric: 'Pending vendors', value: data.pendingVendors },
    { metric: 'Pending reviews', value: data.pendingReviews },
  ];
}

function labeledRows(
  label: string,
  rows: Array<{ name?: string; businessName?: string; revenue: number; count?: number }>,
): Record<string, unknown>[] {
  return rows.map((row, index) => ({
    metric: `${label} #${index + 1}`,
    value: row.businessName ?? row.name ?? '',
    extra: row.revenue,
  }));
}

export async function buildPlatformAnalyticsExport(
  data: PlatformAnalytics,
  format: 'xlsx' | 'csv' | 'pdf',
): Promise<Buffer> {
  const columns = [
    { key: 'metric', labelKey: 'metric' },
    { key: 'value', labelKey: 'value' },
    { key: 'extra', labelKey: 'revenue', format: 'currency' as const },
  ];
  const rows = [
    ...summaryRows(data),
    ...labeledRows('Top vendor', data.topVendors),
    ...labeledRows('Top category', data.topCategories),
    ...data.orderVolume.map((row) => ({
      metric: `Volume ${row.date}`,
      value: row.count,
      extra: row.revenue,
    })),
  ];

  if (format === 'csv') {
    return buildCsvBuffer(columns, rows);
  }
  if (format === 'pdf') {
    return renderReportTablePdf({
      title: 'Platform Analytics',
      columns: columns.map((c) => ({ key: c.key, label: c.labelKey })),
      rows,
      emptyMessage: 'No analytics data',
    });
  }
  return buildExcelBuffer(columns, rows, 'platform-analytics');
}

export { SUMMARY_COLUMNS };
