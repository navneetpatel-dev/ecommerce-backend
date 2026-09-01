import type { ReportDefinition, ReportFilters } from '../types';
import { reportExportConfig } from '../../reportExportConfig';

/**
 * Yields row chunks for streaming export. Runs COUNT once on the first OFFSET
 * page unless `knownTotal` is provided (then COUNT is skipped entirely).
 * Uses `def.exportQuery` keyset pagination when the report defines it.
 */
export async function* createReportRowIterator(
  def: ReportDefinition,
  filters: ReportFilters,
  knownTotal?: number,
): AsyncGenerator<Record<string, unknown>[], void, unknown> {
  const chunkSize = reportExportConfig.chunkSize;

  if (def.exportQuery) {
    let cursor: { values: unknown[] } | null = null;
    const maxPages =
      reportExportConfig.maxRows > 0
        ? Math.ceil(reportExportConfig.maxRows / chunkSize) + 1
        : 10_000;
    let pages = 0;
    let lastCursorKey: string | null = null;
    while (pages < maxPages) {
      const page = await def.exportQuery(filters, cursor, chunkSize);
      if (page.rows.length === 0) break;
      yield page.rows;
      pages += 1;
      if (!page.nextCursor || page.rows.length < chunkSize) break;
      const cursorKey = JSON.stringify(page.nextCursor.values);
      if (cursorKey === lastCursorKey) break;
      lastCursorKey = cursorKey;
      cursor = page.nextCursor;
    }
    return;
  }

  let page = 1;
  let total = knownTotal;

  while (true) {
    const skipCount = total != null;
    const pageFilters: ReportFilters = {
      ...filters,
      page,
      limit: chunkSize,
      ...(skipCount ? { _exportSkipCount: true, _exportKnownTotal: total } : {}),
    };
    const result = await def.query(pageFilters);
    if (total == null) total = result.total;
    if (result.rows.length === 0) break;
    yield result.rows;
    if (result.rows.length < chunkSize) break;
    if (total != null && page * chunkSize >= total) break;
    page += 1;
  }
}

export async function countReportRows(
  def: ReportDefinition,
  filters: ReportFilters,
): Promise<number> {
  const probe = await def.query({ ...filters, page: 1, limit: 1 });
  return probe.total;
}
