import type { ReportFilters, ReportQueryResult } from '../types';
import { reportExportConfig } from '../../reportExportConfig';
import { REPORT_EXPORT_PAGE_SIZE } from '../types';

/** Export paging via report `query()` — skips COUNT after page 1 when total is known. */
export function createOffsetExportQuery(
  queryFn: (filters: ReportFilters) => Promise<ReportQueryResult>,
) {
  return async (
    filters: ReportFilters,
    cursor: { values: unknown[] } | null,
    limit: number,
  ) => {
    const page = cursor ? Number(cursor.values[0]) : 1;
    const knownTotal =
      cursor && cursor.values[1] != null ? Number(cursor.values[1]) : undefined;
    const result = await queryFn({
      ...filters,
      page,
      limit,
      ...(page > 1 && knownTotal != null
        ? { _exportSkipCount: true, _exportKnownTotal: knownTotal }
        : {}),
    });
    const total = page === 1 ? result.total : (knownTotal ?? result.total);
    const hasMore = page * limit < total;
    return {
      rows: result.rows,
      nextCursor: hasMore ? { values: [page + 1, total] } : null,
    };
  };
}

/** Single-page / aggregate reports (reconciliation, vendor-summary, etc.). */
export function createSingleShotExportQuery(
  queryFn: (filters: ReportFilters) => Promise<ReportQueryResult>,
) {
  return async (
    filters: ReportFilters,
    cursor: { values: unknown[] } | null,
    _limit: number,
  ) => {
    if (cursor) return { rows: [], nextCursor: null };
    const cap = Math.min(
      REPORT_EXPORT_PAGE_SIZE,
      reportExportConfig.maxRows > 0 ? reportExportConfig.maxRows : REPORT_EXPORT_PAGE_SIZE,
    );
    const result = await queryFn({ ...filters, page: 1, limit: cap });
    return { rows: result.rows, nextCursor: null };
  };
}
