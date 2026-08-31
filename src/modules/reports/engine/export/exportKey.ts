import { createHash } from 'node:crypto';
import type { ReportExportFormat } from '../csvExporter';

export function buildExportKey(input: {
  userId: string;
  reportType: string;
  filtersUsed: Record<string, unknown>;
  format: ReportExportFormat;
}): string {
  const payload = JSON.stringify({
    userId: input.userId,
    reportType: input.reportType,
    format: input.format,
    filters: stableFilters(input.filtersUsed),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function stableFilters(filters: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(filters).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'reportsPath' || key === 'page' || key === 'limit') continue;
    out[key] = filters[key];
  }
  return out;
}
